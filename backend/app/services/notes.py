"""Study AI: turn a student's lecture / textbook / slides / pasted text into
notes that link back to the source (reuses the ingestion pipeline)."""
import logging
import math
import re
import uuid
from datetime import datetime, timezone

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.models import ContentUnit, Flashcard, KbSource, StudyMaterial
from app.services import ingestion, llm, retrieval
from app.services.llm import LLMError, arr, obj

log = logging.getLogger(__name__)

# The five steps shown to students while their material is processed.
STEPS = ["Found your lesson", "Listening to the video and reading pages", "Looking at diagrams and figures",
         "Sorting it into topics", "Linking notes back to the source"]

ICONS = {"bolt", "trending_flat", "height", "block", "function", "texture", "account_tree", "local_fire_department",
         "science", "calculate", "public", "psychology", "biotech", "eco", "water_drop", "sunny", "hub", "timeline",
         "balance", "gavel", "payments", "account_balance", "language", "history_edu", "lightbulb", "category",
         "change_history", "straighten", "speed", "thermostat", "electric_bolt", "visibility", "memory", "grass"}

SECTIONS_SCHEMA = obj({
    "title": llm.S,
    "sections": arr(obj({
        "heading": llm.S, "text": llm.S, "term": llm.S, "definition": llm.S, "example": llm.S, "cite": llm.INT,
    }, ["heading", "text", "cite"])),
})

EXTRAS_SCHEMA = obj({
    "short_notes": arr(llm.S),
    "key_points": arr(llm.S),
    "concepts": arr(obj({"name": llm.S, "meaning": llm.S, "icon": llm.S})),
    "formulas": arr(obj({"name": llm.S, "formula": llm.S, "unit": llm.S})),
    "confusions": arr(obj({"confusion": llm.S, "clarification": llm.S})),
    "map_center": llm.S,
    "map_nodes": arr(obj({"label": llm.S, "explanation": llm.S})),
    "map_edges": arr(arr(llm.S)),
    "revision_checklist": arr(llm.S),
    "flashcards": arr(obj({"front": llm.S, "back": llm.S, "topic": llm.S, "section": llm.INT})),
    "audio_script": llm.S,
})

LANG = {"en": "Write in simple English.", "hing": "Write in Hinglish (Hindi in Roman letters mixed with English terms).",
        "hi": "Write in Hindi (Devanagari), keeping formulas and symbols as they are."}


def _set(db: Session, m: StudyMaterial, **kw) -> None:
    for k, v in kw.items():
        setattr(m, k, v)
    db.commit()


def layout_map(center: str, nodes: list[dict], edges: list[list[str]]) -> dict:
    out = [{"id": "n0", "l": center, "t": "", "x": 450, "y": 270, "main": True}]
    k = len(nodes)
    for i, n in enumerate(nodes):
        ang = -math.pi / 2 + 2 * math.pi * i / max(k, 1)
        rx, ry = (360, 210) if i % 2 == 0 else (250, 150)
        out.append({"id": f"n{i + 1}", "l": n["label"][:40], "t": n.get("explanation", "")[:300],
                    "x": round(450 + rx * math.cos(ang)), "y": round(270 + ry * math.sin(ang)), "main": False})
    by_label = {n["l"].strip().lower(): n["id"] for n in out}
    es: list[list[str]] = []
    for e in edges:
        if isinstance(e, list) and len(e) >= 2:
            a, b = by_label.get(str(e[0]).strip().lower()), by_label.get(str(e[1]).strip().lower())
            if a and b and a != b and [a, b] not in es and [b, a] not in es:
                es.append([a, b])
    linked = {x for e in es for x in e}
    for n in out[1:]:
        if n["id"] not in linked:
            es.append([n["id"], "n0"])
    return {"nodes": out, "edges": es}


PACK_UNITS = 48  # per revision pack, spread across its topics


def pack_units(db: Session, topic_ids: list[uuid.UUID]) -> list[ContentUnit]:
    """Approved class material (the admin knowledge base) for these topics, in topic then page order."""
    per = max(6, PACK_UNITS // max(len(topic_ids), 1))
    out: list[ContentUnit] = []
    for tid in topic_ids:
        out += list(db.scalars(select(ContentUnit).join(KbSource).where(
            ContentUnit.topic_id == tid, ContentUnit.approved.is_(True), KbSource.origin == "admin", KbSource.status == "Ready")
            .order_by(KbSource.created_at, ContentUnit.position).limit(per)))
    return out


def generate(db: Session, material_id: uuid.UUID, lang: str = "en") -> StudyMaterial:
    m = db.get(StudyMaterial, material_id)
    src = db.get(KbSource, m.source_id) if m.source_id else None
    if src is None and not m.topic_ids:
        _set(db, m, status="Failed", error="The source for this material is missing.")
        return m
    try:
        _set(db, m, stage=1, status="Processing", error="")
        focus = ""
        if m.topic_ids:  # revision pack: build from the knowledge base, nothing to ingest
            units = pack_units(db, list(m.topic_ids))
            focus = (" This is a revision pack for a student who is weak in these topics: put the core ideas first, "
                     "state definitions precisely, and call out the mistakes students usually make.")
            _set(db, m, stage=4)
        else:
            src = ingestion.ingest(db, src.id)
            if src.status == "Failed":
                _set(db, m, status="Failed", error=src.error or "We couldn't read this source.")
                return m
            if src.title and m.title in ("", "Untitled", src.url):
                m.title = src.title[:400]
            _set(db, m, stage=4)
            units = list(db.scalars(select(ContentUnit).where(ContentUnit.source_id == src.id).order_by(ContentUnit.position)))
        if not units:
            _set(db, m, status="Failed", error="Nothing readable was found in this source.")
            return m
        numbered = {i + 1: u for i, u in enumerate(units)}
        parts: list[list[int]] = [[]]
        size = 0
        for n, u in numbered.items():
            if size + len(u.text) > 12000 and parts[-1]:
                parts.append([])
                size = 0
            parts[-1].append(n)
            size += len(u.text)

        sections: list[dict] = []
        title = ""
        for part in parts[:8]:
            ctx = "\n\n".join(f"[{n}] ({numbered[n].kind}, {numbered[n].location}) {numbered[n].text[:1500]}" for n in part)
            out = llm.chat(
                [{"role": "system", "content": (
                    "You write clear study notes for an Indian school student from their own class material. "
                    "Split the material into logical sections in teaching order. For each section write a heading, "
                    "a 2-4 sentence explanation, optionally one key term with its definition, and optionally a short "
                    "worked example. cite is the excerpt number the section mainly comes from. Use only the excerpts."
                    + focus + " " + LANG.get(lang, LANG["en"]))},
                 {"role": "user", "content": f"Excerpts:\n{ctx}"}],
                task="notes_sections", schema=SECTIONS_SCHEMA, temperature=0.3,
            )
            title = title or (out.get("title") or "").strip()
            for s in out.get("sections", []):
                if not isinstance(s, dict) or not s.get("heading") or not s.get("text"):
                    continue
                u = numbered.get(s.get("cite")) or numbered[part[0]]
                sections.append({
                    "h": s["heading"].strip()[:200], "p": s["text"].strip(),
                    "def": [s["term"].strip(), s["definition"].strip()] if s.get("term") and s.get("definition") else None,
                    "ex": (s.get("example") or "").strip() or None,
                    "src": {"loc": u.location if src else f"{u.source.title[:60]} · {u.location}", "unit_id": str(u.id),
                            "icon": retrieval.SRC_TYPE.get(u.source.kind, ("", "description"))[1]},
                })
        if not sections:
            raise LLMError("No notes could be written from this source.")

        digest = "\n".join(f"[{i}] {s['h']}: {s['p']}" + (f" Definition: {s['def'][0]} — {s['def'][1]}" if s["def"] else "")
                           + (f" Example: {s['ex']}" if s["ex"] else "") for i, s in enumerate(sections))
        ex = llm.chat(
            [{"role": "system", "content": (
                "From these study notes, produce revision material for a school student. short_notes: 5-8 one-line "
                "points. key_points: 3-5 exam tips. concepts: 4-8 key concepts with a one-line meaning and an icon "
                f"name from this list: {', '.join(sorted(ICONS))}. formulas: every formula in the notes (empty if none). "
                "confusions: 2-4 common mix-ups and how to tell them apart. map_center: the main idea; map_nodes: 5-10 "
                "related concepts with a one-sentence explanation; map_edges: pairs of labels that are directly "
                "related (use exact labels, the center included). revision_checklist: 5-8 'I can …' statements. "
                "flashcards: 6-12 question/answer cards, section is the notes section index they come from. "
                "audio_script: a friendly 60-90 second spoken recap. Use only the notes." + focus + " " + LANG.get(lang, LANG["en"]))},
             {"role": "user", "content": digest[:14000]}],
            task="notes_extras", schema=EXTRAS_SCHEMA, temperature=0.3,
        )

        def strs(key: str, n: int) -> list[str]:
            return [str(x).strip() for x in ex.get(key, []) if str(x).strip()][:n]

        concepts = [{"a": c["name"].strip(), "b": c.get("meaning", "").strip(),
                     "icon": c.get("icon") if c.get("icon") in ICONS else "lightbulb"}
                    for c in ex.get("concepts", []) if isinstance(c, dict) and c.get("name")][:8]
        formulas = [{"n": f.get("name", "").strip(), "f": f["formula"].strip(), "u": (f.get("unit") or "—").strip() or "—"}
                    for f in ex.get("formulas", []) if isinstance(f, dict) and f.get("formula")][:16]
        confusions = [{"a": c["confusion"].strip(), "b": c.get("clarification", "").strip()}
                      for c in ex.get("confusions", []) if isinstance(c, dict) and c.get("confusion")][:6]
        nodes = [n for n in ex.get("map_nodes", []) if isinstance(n, dict) and n.get("label")][:10]
        cmap = layout_map((ex.get("map_center") or title or m.title)[:40], nodes, ex.get("map_edges", []))

        db.execute(delete(Flashcard).where(Flashcard.material_id == m.id))
        for i, fc in enumerate([f for f in ex.get("flashcards", []) if isinstance(f, dict) and f.get("front") and f.get("back")][:16]):
            sec = sections[fc["section"]] if isinstance(fc.get("section"), int) and 0 <= fc["section"] < len(sections) else sections[0]
            db.add(Flashcard(material_id=m.id, position=i, front=fc["front"].strip(), back=fc["back"].strip(),
                             topic_label=(fc.get("topic") or sec["h"]).strip()[:200], source_loc=sec["src"]["loc"],
                             unit_id=uuid.UUID(sec["src"]["unit_id"])))

        m.outputs = {
            "lang": lang,
            "full": sections,
            "short": strs("short_notes", 10),
            "key_points": strs("key_points", 6),
            "concepts": concepts,
            "formulas": formulas,
            "confusions": confusions,
            "map": cmap,
            "revision": strs("revision_checklist", 10),
            "audio_script": (ex.get("audio_script") or "").strip(),
            "generated_at": datetime.now(timezone.utc).isoformat(),
        }
        if title and not m.topic_ids and (m.title in ("", "Untitled") or (src.url and m.title == src.url)):
            m.title = title[:400]
        m.subject_label = m.subject_label or _subject_label(db, units)
        m.status, m.stage = "Ready", 5
        db.commit()
        return m
    except Exception as e:  # noqa: BLE001
        db.rollback()
        m = db.get(StudyMaterial, material_id)
        m.status = "Failed"
        m.error = str(e)[:500] or "Generation failed"
        db.commit()
        log.exception("Study material %s failed", material_id)
        return m


def _subject_label(db: Session, units: list[ContentUnit]) -> str:
    from collections import Counter

    from app.models import Chapter, Subject, Topic

    ids = [u.topic_id for u in units if u.topic_id]
    if not ids:
        return ""
    tid = Counter(ids).most_common(1)[0][0]
    row = db.execute(select(Subject.name, Subject.class_level, Chapter.name).select_from(Topic)
                     .join(Chapter, Topic.chapter_id == Chapter.id).join(Subject, Chapter.subject_id == Subject.id)
                     .where(Topic.id == tid)).first()
    if not row:
        return ""
    cls = re.sub(r"\D", "", row[1] or "")
    return f"{row[0]} {cls}".strip() + f" · {row[2]}"
