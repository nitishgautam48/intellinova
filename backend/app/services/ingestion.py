"""Multimodal knowledge-base ingestion (architecture v4, page 2).

Stages (shown in the admin console as progress dots):
  0 Transcribe / OCR  1 Figures  2 Segment  3 Tag topics (+ subtopics, concepts, prerequisites)
  4 Identify topics (propose new topics/subtopics for material the curriculum doesn't cover)  5 Index
"""
import difflib
import logging
import uuid
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.config import settings
from app.models import Chapter, ContentUnit, KbSource, StudentProfile, Subject, Topic, TopicPrereq, TopicProposal
from app.services import embeddings, llm, parsing
from app.services.llm import LLMError, arr, obj

log = logging.getLogger(__name__)

STAGES = ["Transcribe / OCR", "Figures", "Segment", "Tag topics", "Identify topics", "Index"]
LOW_CONFIDENCE = 0.7
UNMATCHED = 0.45  # below this a unit is treated as not covered by the curriculum


def _set_stage(db: Session, src: KbSource, stage: int) -> None:
    src.stage = stage
    db.commit()


# --------------------------------------------------------------------------- figures


CAPTION_SCHEMA = obj({"kind": llm.S, "caption": llm.S, "labels": arr(llm.S)})


def caption_figure(image_path: str, context: str) -> dict | None:
    try:
        data = Path(image_path).read_bytes()
    except OSError:
        return None
    prompt = (
        "You are describing a figure from a school textbook, slide or lecture so that students can "
        "search for it and a tutor can cite it. Describe what the figure shows in 1-2 plain sentences, "
        "and list every visible label, axis name, component or table entry (max 12). "
        "kind is one of: diagram, graph, table, photo, equation, other."
        + (f"\nNearby text or caption: {context[:400]}" if context else "")
    )
    try:
        out = llm.chat([{"role": "user", "content": prompt}], task="caption_figure", schema=CAPTION_SCHEMA,
                       model=settings.vision_model, images=[data], temperature=0.1)
    except LLMError as e:
        log.warning("Figure captioning skipped: %s", e)
        return None
    if not isinstance(out, dict) or not out.get("caption"):
        return None
    if out.get("kind") == "photo" and not out.get("labels"):
        return None  # decorative photos add noise to retrieval
    return out


# --------------------------------------------------------------------------- tagging


def candidate_topics(db: Session, src: KbSource) -> list[Topic]:
    q = select(Topic).join(Chapter).join(Subject)
    if src.chapter_id:
        q = q.where(Topic.chapter_id == src.chapter_id)
    elif src.subject_id:
        q = q.where(Chapter.subject_id == src.subject_id)
    elif src.origin == "student" and src.owner_id:
        prof = db.get(StudentProfile, src.owner_id)
        if prof and prof.subject_ids:
            q = q.where(Chapter.subject_id.in_(prof.subject_ids))
    q = q.where(Chapter.disabled.is_(False)).order_by(Subject.position, Chapter.position, Topic.position)
    return list(db.scalars(q).all())[:400]


TAG_SCHEMA = obj({
    "units": arr(obj({
        "i": llm.INT,
        "topic": llm.INT,
        "confidence": llm.N,
        "subtopic": llm.S,
        "concepts": arr(llm.S),
        "prerequisites": arr(llm.INT),
    }))
})


def tag_units(db: Session, src: KbSource, units: list[ContentUnit]) -> None:
    topics = candidate_topics(db, src)
    if not topics:
        for u in units:
            u.confidence = 0.0
        return
    names = [f"{t.name} ({t.chapter.name})" for t in topics]
    tvecs = embeddings.embed([f"{t.name}. {t.summary}" for t in topics], "passage")
    prereq_map: dict[uuid.UUID, list[uuid.UUID]] = {}
    for tp in db.scalars(select(TopicPrereq).where(TopicPrereq.topic_id.in_([t.id for t in topics]))):
        prereq_map.setdefault(tp.topic_id, []).append(tp.prereq_id)

    # Embedding shortlist per unit (cheap, always available)
    uvecs = [u.embedding if u.embedding is not None else embeddings.embed_one(u.text[:1500], "passage") for u in units]
    shortlist: list[list[tuple[int, float]]] = []
    for uv in uvecs:
        sims = sorted(((i, embeddings.cosine(uv, tv)) for i, tv in enumerate(tvecs)), key=lambda x: -x[1])
        shortlist.append(sims[:5])

    llm_ok = True
    batch = 8
    for b0 in range(0, len(units), batch):
        chunk = units[b0 : b0 + batch]
        cand_idx = sorted({i for sl in shortlist[b0 : b0 + batch] for i, _ in sl})
        cand_lines = "\n".join(f"{i}: {names[i]}" for i in cand_idx)
        unit_lines = "\n\n".join(
            f"[{k}] ({u.kind}, {u.location}) {u.text[:700]}" for k, u in enumerate(chunk)
        )
        result: dict[int, dict] = {}
        if llm_ok:
            try:
                out = llm.chat(
                    [
                        {"role": "system", "content": (
                            "You tag chunks of school study material to a syllabus. For each chunk choose the single "
                            "best topic number from the list (or -1 if none fits), a confidence from 0 to 1, a short "
                            "subtopic name for the part of that topic the chunk covers (2-6 words, reuse the same name "
                            "for chunks about the same part), up to 4 short concept names the chunk explains, and the "
                            "topic numbers a student must know first (prerequisites) if the chunk clearly builds on them.")},
                        {"role": "user", "content": f"Topics:\n{cand_lines}\n\nChunks:\n{unit_lines}\n\n"
                                                    "Return JSON: {\"units\": [{\"i\": chunk number, \"topic\": n, "
                                                    "\"confidence\": 0-1, \"subtopic\": \"...\", \"concepts\": [...], "
                                                    "\"prerequisites\": [...]}]}"},
                    ],
                    task="tag_units", schema=TAG_SCHEMA, temperature=0.0,
                )
                for row in out.get("units", []):
                    if isinstance(row, dict) and isinstance(row.get("i"), int):
                        result[row["i"]] = row
            except LLMError as e:
                log.warning("Topic tagging falling back to embeddings only: %s", e)
                llm_ok = False
        for k, u in enumerate(chunk):
            sl = shortlist[b0 + k]
            best_i, best_sim = sl[0] if sl else (-1, 0.0)
            row = result.get(k)
            if row and isinstance(row.get("topic"), int) and 0 <= row["topic"] < len(topics):
                ti = row["topic"]
                conf = max(0.0, min(1.0, float(row.get("confidence", 0.5))))
                # If the model picked something embeddings consider unrelated, trust it less.
                emb_rank = next((r for r, (i, _) in enumerate(sl) if i == ti), None)
                if emb_rank is None:
                    conf *= 0.75
                u.topic_id = topics[ti].id
                u.subtopic = _clean(row.get("subtopic")) or _heading_subtopic(u)
                u.concepts = [c.strip()[:80] for c in (row.get("concepts") or []) if isinstance(c, str) and c.strip()][:4]
                pre = [topics[p].id for p in (row.get("prerequisites") or [])
                       if isinstance(p, int) and 0 <= p < len(topics) and p != ti]
                u.prereq_topic_ids = list(dict.fromkeys(pre + prereq_map.get(topics[ti].id, [])))
                u.confidence = round(conf, 3)
            elif row and row.get("topic") == -1:
                u.topic_id = None
                u.confidence = round(float(row.get("confidence", 0.3)), 3)
            elif best_i >= 0:
                u.topic_id = topics[best_i].id
                u.subtopic = _heading_subtopic(u)
                u.prereq_topic_ids = prereq_map.get(topics[best_i].id, [])
                u.confidence = round(max(0.0, min(1.0, (best_sim - 0.2) / 0.6)), 3)
        db.commit()


def _clean(s) -> str:
    return " ".join(str(s or "").split()).strip(" .:-")[:200]


def _heading_subtopic(u: ContentUnit) -> str:
    h = _clean(u.heading)
    return h if 3 <= len(h) <= 80 else ""


def normalize_subtopics(units: list[ContentUnit]) -> None:
    """Merge near-duplicate subtopic names within a topic ("Series combination" / "series combinations")."""
    canon: dict = {}
    for u in units:
        if not u.subtopic:
            continue
        names = canon.setdefault(u.topic_id, [])
        low = u.subtopic.lower()
        match = next((n for n in names if n.lower() == low or difflib.SequenceMatcher(None, n.lower(), low).ratio() >= 0.85), None)
        if match:
            u.subtopic = match
        else:
            names.append(u.subtopic)


# --------------------------------------------------------------------------- identify new topics

PROPOSE_SCHEMA = obj({"chapters": arr(obj({"name": llm.S, "topics": arr(obj({
    "name": llm.S, "summary": llm.S, "subtopics": arr(obj({"name": llm.S, "chunks": arr(llm.INT)}))}))}))})


def propose_topics(db: Session, src: KbSource, units: list[ContentUnit]) -> int:
    """Group material the curriculum doesn't cover into proposed chapters › topics › subtopics for staff review.
    If the model re-finds a topic that already exists, the units are simply tagged to it."""
    if src.origin != "admin":
        return 0
    db.execute(delete(TopicProposal).where(TopicProposal.source_id == src.id, TopicProposal.status == "pending"))
    loose = [u for u in units if u.topic_id is None or u.confidence < UNMATCHED]
    if len(loose) < 2:
        db.commit()
        return 0
    existing = candidate_topics(db, src)
    known = {t.name.strip().lower(): t for t in existing}
    subj_id = src.subject_id or (db.get(Chapter, src.chapter_id).subject_id if src.chapter_id else None)
    chapters = {c.name.strip().lower(): c for c in db.scalars(select(Chapter).where(Chapter.subject_id == subj_id))} if subj_id else {}
    have = "\n".join(f"- {t.chapter.name} › {t.name}" for t in existing[:80]) or "(none yet)"
    made = 0
    for b0 in range(0, len(loose), 60):
        chunk = loose[b0 : b0 + 60]
        lines = "\n".join(f"[{k}] ({u.location}) {u.heading + ': ' if u.heading else ''}{u.text[:220]}" for k, u in enumerate(chunk))
        try:
            out = llm.chat([
                {"role": "system", "content": "You organise school study material into a syllabus. The chunks below are not covered "
                                              "by the existing topics. Group them into chapters, topics and subtopics the way a "
                                              "textbook would (a topic is one lesson; a subtopic is a part of it). Reuse an "
                                              "existing topic name exactly if a chunk belongs to it. Give each topic a one-sentence "
                                              "summary and list which chunk numbers belong to each subtopic. Ignore chunks that "
                                              "are not teaching content (covers, indexes, exercises lists)."},
                {"role": "user", "content": f"Existing topics:\n{have}\n\nChunks:\n{lines}"}],
                task="propose_topics", schema=PROPOSE_SCHEMA, temperature=0.0)
        except LLMError as e:
            log.warning("Topic identification skipped: %s", e)
            break
        for ch in (out.get("chapters") or []) if isinstance(out, dict) else []:
            cname = _clean(ch.get("name"))
            for tp in ch.get("topics") or []:
                tname = _clean(tp.get("name"))
                if not tname:
                    continue
                unit_sub: dict[str, str] = {}
                subs: list[str] = []
                for st in tp.get("subtopics") or []:
                    sname = _clean(st.get("name"))
                    for k in st.get("chunks") or []:
                        if isinstance(k, int) and 0 <= k < len(chunk):
                            unit_sub[str(chunk[k].id)] = sname
                    if sname and sname not in subs:
                        subs.append(sname)
                if not unit_sub:
                    continue
                t = known.get(tname.lower())
                if t:
                    for u in chunk:
                        if str(u.id) in unit_sub:
                            u.topic_id, u.subtopic, u.confidence = t.id, unit_sub[str(u.id)] or u.subtopic, max(u.confidence, LOW_CONFIDENCE)
                    continue
                chap = chapters.get(cname.lower()) if cname else (db.get(Chapter, src.chapter_id) if src.chapter_id else None)
                db.add(TopicProposal(source_id=src.id, subject_id=subj_id, chapter_id=chap.id if chap else None,
                                     chapter_name=chap.name if chap else (cname or "New chapter"), topic_name=tname,
                                     summary=_clean(tp.get("summary"))[:1000], subtopics=subs[:12], unit_subtopics=unit_sub))
                made += 1
    db.commit()
    return made


# --------------------------------------------------------------------------- pipeline


def parse_source(src: KbSource) -> parsing.Parsed:
    if src.kind == "textbook":
        if src.file_path.lower().endswith(".pdf"):
            return parsing.parse_pdf(src.file_path)
        raise ValueError("Textbooks must be PDF files")
    if src.kind == "slides":
        if src.file_path.lower().endswith(".pptx"):
            return parsing.parse_pptx(src.file_path)
        if src.file_path.lower().endswith(".pdf"):  # slides exported to PDF
            p = parsing.parse_pdf(src.file_path)
            for s in p.segments:
                s.kind, s.slide = "Slide", s.page
                s.location = s.location.replace("p. ", "Slide ")
            for f in p.figures:
                f.slide = f.page
                f.location = f.location.replace("p. ", "Slide ")
            p.size_label = p.size_label.replace("pages", "slides")
            return p
        raise ValueError("Slide decks must be .pptx or .pdf")
    if src.kind == "video":
        if src.url:
            return parsing.parse_video_url(src.url)
        return parsing.parse_video_file(src.file_path)
    if src.kind == "text":
        return parsing.parse_text(Path(src.file_path).read_text(encoding="utf-8") if src.file_path else "")
    raise ValueError(f"Unknown source kind {src.kind}")


def ingest(db: Session, source_id: uuid.UUID) -> KbSource:
    src = db.get(KbSource, source_id)
    if src is None:
        raise ValueError("source not found")
    src.status, src.error = "Processing", ""
    _set_stage(db, src, 0)
    try:
        parsed = parse_source(src)
        if parsed.size_label:
            src.size_label = parsed.size_label
        if parsed.title and (not src.title or src.title == src.url):
            src.title = parsed.title[:400]
        if parsed.videos:
            src.stats = {**(src.stats or {}), "videos": parsed.videos}
        _set_stage(db, src, 1)

        segments = list(parsed.segments)
        figs = 0
        for f in parsed.figures:
            cap = caption_figure(f.image_path, f.context)
            if not cap:
                continue
            figs += 1
            labels = [str(x)[:80] for x in cap.get("labels", [])][:12]
            text = cap["caption"] + (f" Labels: {', '.join(labels)}." if labels else "")
            segments.append(parsing.Segment("Diagram", text, f.location, page=f.page, slide=f.slide,
                                            t_start=f.t_start, heading=f.context[:200], image_path=f.image_path,
                                            labels=labels))
        _set_stage(db, src, 2)

        if not segments:
            raise ValueError("Nothing readable was found in this source.")
        db.execute(delete(ContentUnit).where(ContentUnit.source_id == src.id))
        order = {"Text": 0, "Slide": 0, "Transcript": 0, "Diagram": 1}
        segments.sort(key=lambda s: (s.page or s.slide or 0, s.t_start or 0, order.get(s.kind, 0)))
        units = [
            ContentUnit(source_id=src.id, position=i, kind=s.kind, text=s.text.strip(), location=s.location[:120],
                        page=s.page, slide=s.slide, t_start=s.t_start, t_end=s.t_end, heading=s.heading[:300],
                        labels=s.labels, image_path=s.image_path)
            for i, s in enumerate(segments) if s.text.strip()
        ]
        # Embed first: the vectors drive both tagging shortlists and retrieval.
        vecs = []
        for b in range(0, len(units), 64):
            vecs += embeddings.embed([f"{u.heading}\n{u.text}"[:2000] for u in units[b:b + 64]], "passage")
        for u, v in zip(units, vecs):
            u.embedding = v
        db.add_all(units)
        db.commit()
        _set_stage(db, src, 3)

        tag_units(db, src, units)
        normalize_subtopics(units)
        db.commit()
        _set_stage(db, src, 4)
        proposals = propose_topics(db, src, units)
        _set_stage(db, src, 5)

        low = 0
        for u in units:
            u.approved = u.confidence >= LOW_CONFIDENCE
            low += 0 if u.approved else 1
        src.stats = {**(src.stats or {}), "units": len(units), "figures": figs, "low_confidence": low, "proposals": proposals}
        src.status = "Needs Review" if low and src.origin == "admin" else "Ready"
        src.stage = 6
        src.updated_at = datetime.now(timezone.utc)
        db.commit()
        return src
    except Exception as e:  # noqa: BLE001 - any failure marks the source failed with a readable reason
        db.rollback()
        src = db.get(KbSource, source_id)
        src.status = "Failed"
        src.error = str(e)[:1000] or e.__class__.__name__
        db.commit()
        log.exception("Ingestion failed for %s", source_id)
        return src
