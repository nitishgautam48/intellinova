"""Automatic YouTube video discovery for a syllabus topic (or a free-text search).

Pipeline, cheapest filters first so the YouTube quota and the LLM are spent only on plausible videos:

1. Search YouTube: the Data API when YOUTUBE_API_KEY is set (safeSearch=strict, embeddable, India region),
   otherwise a yt-dlp search that needs no key.
2. Hard filters: 2-90 minutes (no Shorts, no 5-hour streams), not live, no profanity, not a video a curator
   already disabled or that is known to be unavailable.
3. Embedding pre-rank against the topic, then captions for the shortlist.
4. The local LLM judges each shortlisted video against the syllabus topic (relevant? how well? level?
   language?) and anything below `discovery_min_relevance` is dropped.
5. Rank by judge score, similarity, engagement, captions, trusted channel and (optional) Reddit mentions,
   and add the best as Active resources marked meta.origin="discovered". Curators can disable any of them,
   and a disabled video is never re-added.
"""
import logging
import math
import re
import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.config import settings
from app.models import Chapter, Resource, ResourceTopic, StudentProfile, Subject, Topic, VideoDiscovery
from app.services import embeddings, llm, parsing, reddit
from app.services.llm import LLMError, obj

log = logging.getLogger(__name__)

BLOCKED = ("Disabled", "Unavailable")
HINDI = {"hindi", "hinglish"}
JUDGE_SCHEMA = obj({"relevant": llm.B, "score": llm.N, "difficulty": llm.S, "language": llm.S, "reason": llm.S})
QUERY_SCHEMA = obj({"academic": llm.B, "topic": llm.S})

# Indirection so tests (and offline installs) can swap the network calls.
fetch_captions = parsing.youtube_captions


def _now() -> datetime:
    return datetime.now(timezone.utc)


def lang_of(prof: StudentProfile | None) -> str:
    """'hi' when the student's first language is Hindi or Hinglish, else 'en'."""
    first = (prof.languages[0] if prof and prof.languages else "English").lower()
    return "hi" if first in HINDI else "en"


def class_digits(class_level: str) -> str:
    return re.sub(r"\D", "", class_level or "")


def topic_video_count(db: Session, topic_id: uuid.UUID) -> int:
    return db.scalar(select(func.count()).select_from(Resource).join(ResourceTopic, ResourceTopic.resource_id == Resource.id)
                     .where(ResourceTopic.topic_id == topic_id, Resource.status == "Active",
                            Resource.rtype.in_(("Video", "Playlist")))) or 0


# --------------------------------------------------------------------------- scheduling


def _fresh(row: VideoDiscovery) -> bool:
    age = _now() - (row.updated_at or row.created_at)
    if row.status in ("queued", "running"):
        return age < timedelta(minutes=15)  # a stuck job is retried after 15 minutes
    if row.status == "failed":
        return age < timedelta(hours=1)
    return age < timedelta(days=settings.discovery_ttl_days)


def _enqueue(db: Session, key: str, **fields) -> VideoDiscovery | None:
    if not settings.discovery_enabled:
        return None
    row = db.scalar(select(VideoDiscovery).where(VideoDiscovery.key == key))
    if row and _fresh(row) and not fields.pop("force", False):
        return row
    fields.pop("force", None)
    if row is None:
        row = VideoDiscovery(key=key, **fields)
        db.add(row)
    else:
        for k, v in fields.items():
            setattr(row, k, v)
    row.status, row.error, row.updated_at = "queued", "", _now()
    db.commit()
    from app.workers import tasks

    tasks.discover_videos.delay(str(row.id))
    db.refresh(row)
    return row


def for_topic(db: Session, topic: Topic, prof: StudentProfile | None = None, force: bool = False) -> VideoDiscovery | None:
    """Queue discovery for a topic unless it already has enough catalog videos (or a fresh search)."""
    if not force and topic_video_count(db, topic.id) >= settings.discovery_min_videos:
        return None
    lang = lang_of(prof)
    subj = topic.chapter.subject
    return _enqueue(db, f"topic:{topic.id}:{lang}", topic_id=topic.id, label=topic.name, lang=lang,
                    class_level=subj.class_level, query="", force=force)


QUERY_LIMIT_PER_DAY = 15


def _under_daily_limit(user_id: uuid.UUID) -> bool:
    """Free-text discoveries per student per day (each YouTube search costs 100 of the 10,000 daily quota units)."""
    from app.services import cache

    key = f"disc:q:{user_id}:{_now():%Y%m%d}"
    try:
        n = cache.client().incr(key)
        if n == 1:
            cache.client().expire(key, 90000)
        return n <= QUERY_LIMIT_PER_DAY
    except Exception:  # noqa: BLE001 - no Redis: don't block search
        return True


def for_query(db: Session, q: str, prof: StudentProfile | None, user_id: uuid.UUID | None = None) -> VideoDiscovery | None:
    norm = " ".join(q.lower().split())[:200]
    if len(norm) < 3:
        return None
    lang = lang_of(prof)
    cls = prof.class_level if prof else ""
    key = f"q:{norm}:{class_digits(cls)}:{lang}"
    row = db.scalar(select(VideoDiscovery).where(VideoDiscovery.key == key))
    if (row is None or not _fresh(row)) and user_id and not _under_daily_limit(user_id):
        return row
    return _enqueue(db, key, topic_id=None, label=q.strip()[:300], lang=lang,
                    class_level=cls, query=norm)


# --------------------------------------------------------------------------- YouTube search


def _api_search(query: str, lang: str, n: int) -> list[dict]:
    from googleapiclient.discovery import build

    yt = build("youtube", "v3", developerKey=settings.youtube_api_key, cache_discovery=False)
    found = yt.search().list(part="id", q=query, type="video", maxResults=min(n, 50), safeSearch="strict",
                             videoEmbeddable="true", regionCode="IN", relevanceLanguage=lang).execute()
    ids = [i["id"]["videoId"] for i in found.get("items", []) if i.get("id", {}).get("videoId")]
    if not ids:
        return []
    out = []
    for v in yt.videos().list(part="snippet,contentDetails,statistics,status", id=",".join(ids)).execute().get("items", []):
        sn, st = v["snippet"], v.get("statistics", {})
        from app.services.resources import _iso_dur

        out.append({
            "video_id": v["id"], "title": sn.get("title", ""), "description": sn.get("description", "")[:2000],
            "channel": sn.get("channelTitle", ""), "duration": _iso_dur(v["contentDetails"].get("duration", "")),
            "live": sn.get("liveBroadcastContent", "none") != "none",
            "thumbnail": (sn.get("thumbnails", {}).get("high") or sn.get("thumbnails", {}).get("default") or {}).get("url", ""),
            "language": sn.get("defaultAudioLanguage") or sn.get("defaultLanguage") or "",
            "views": int(st.get("viewCount", 0)), "likes": int(st.get("likeCount", 0)), "comments": int(st.get("commentCount", 0)),
            "embeddable": v.get("status", {}).get("embeddable", True), "published": sn.get("publishedAt", ""),
        })
    order = {vid: i for i, vid in enumerate(ids)}
    return sorted(out, key=lambda c: order.get(c["video_id"], 99))


def _ytdlp_search(query: str, n: int) -> list[dict]:
    with parsing._ydl({"extract_flat": True}) as y:
        info = y.extract_info(f"ytsearch{n}:{query}", download=False)
    out = []
    for e in info.get("entries") or []:
        if not e or not e.get("id"):
            continue
        thumbs = e.get("thumbnails") or []
        out.append({
            "video_id": e["id"], "title": e.get("title") or "", "description": (e.get("description") or "")[:2000],
            "channel": e.get("channel") or e.get("uploader") or "", "duration": int(e.get("duration") or 0),
            "live": e.get("live_status") in ("is_live", "is_upcoming"), "thumbnail": thumbs[-1]["url"] if thumbs else "",
            "language": "", "views": int(e.get("view_count") or 0), "likes": 0, "comments": 0, "embeddable": True, "published": "",
        })
    return out


def search_candidates(query: str, lang: str, n: int) -> tuple[list[dict], str]:
    """(candidates, source). Raises on network failure so the job is marked failed and retried later."""
    if settings.youtube_api_key:
        return _api_search(query, lang, n), "youtube-api"
    return _ytdlp_search(query, n), "yt-dlp"


# --------------------------------------------------------------------------- pipeline


def _profane(text: str) -> bool:
    try:
        from better_profanity import profanity

        return profanity.contains_profanity(text)
    except Exception:  # noqa: BLE001 - optional dependency
        return False


def _build_query(row: VideoDiscovery, topic: Topic | None, db: Session) -> tuple[str, str, str]:
    """(youtube query, what the video must teach, context line for the judge)."""
    cls = class_digits(row.class_level)
    hindi = " in hindi" if row.lang == "hi" else ""
    if topic:
        ch: Chapter = topic.chapter
        subj: Subject = ch.subject
        q = f"{topic.name} {ch.name} class {cls} {subj.name}".strip() if cls else f"{topic.name} {ch.name} {subj.name}"
        teach = f"{topic.name} ({ch.name}, {subj.name})" + (f": {topic.summary}" if topic.summary else "")
        ctx = f"{subj.board} Class {cls} {subj.name}, chapter '{ch.name}'".strip()
        return q + hindi, teach, ctx
    q = f"{row.query} class {cls}" if cls else row.query
    return q + hindi, row.query, f"Class {cls} student" if cls else "school student"


def _judge(teach: str, ctx: str, c: dict, transcript: str) -> dict | None:
    out = llm.chat([
        {"role": "system", "content": "You check whether a YouTube video is a good lesson for a school student on a specific "
                                      "syllabus topic. Be strict: it must actually teach the topic (not merely mention it), be "
                                      "appropriate for school students, and not be an advert, reaction, song or unrelated "
                                      "compilation. Reply with: relevant (true/false), score 0-1 for how well it teaches the "
                                      "topic, difficulty (Beginner, Intermediate or Advanced), the teaching language (English, "
                                      "Hindi or Hinglish) and a short reason a student would understand."},
        {"role": "user", "content": f"Syllabus: {ctx}\nTopic to learn: {teach}\n\nVideo title: {c['title']}\nChannel: {c['channel']}\n"
                                    f"Length: {c['duration'] // 60} min\nDescription: {c['description'][:600]}\n\n"
                                    f"Transcript excerpt: {transcript[:1500] or '(no captions)'}"}],
        task="judge_video", schema=JUDGE_SCHEMA, temperature=0.0)
    if not isinstance(out, dict):
        return None
    return out


def _is_academic(q: str, ctx: str) -> str | None:
    """For free-text searches: the cleaned study topic, or None if it isn't something to learn at school."""
    out = llm.chat([
        {"role": "system", "content": "A school student typed a search. Decide whether it is an academic topic they could study "
                                      "(any school subject, exam or concept). If yes, rewrite it as a short, clear topic name."},
        {"role": "user", "content": f"Student: {ctx}\nSearch: {q}"}], task="classify_query", schema=QUERY_SCHEMA, temperature=0.0)
    if isinstance(out, dict) and out.get("academic") and str(out.get("topic", "")).strip():
        return str(out["topic"]).strip()[:120]
    return None


def _lang_label(judged: str, meta_lang: str, row_lang: str) -> list[str]:
    j = (judged or "").strip().capitalize()
    if j in ("English", "Hindi", "Hinglish"):
        return [j]
    if meta_lang.startswith("hi"):
        return ["Hindi"]
    if meta_lang.startswith("en"):
        return ["English"]
    return ["Hindi"] if row_lang == "hi" else ["English"]


def run(db: Session, discovery_id: uuid.UUID) -> VideoDiscovery:
    row = db.get(VideoDiscovery, discovery_id)
    row.status, row.error = "running", ""
    db.commit()
    topic = db.get(Topic, row.topic_id) if row.topic_id else None
    try:
        if not topic:
            cleaned = _is_academic(row.query, f"Class {class_digits(row.class_level)}" if row.class_level else "school student")
            if not cleaned:
                row.status, row.stats = "skipped", {"reason": "not a study topic"}
                db.commit()
                return row
            row.query = cleaned
        query, teach, ctx = _build_query(row, topic, db)
        cands, source = search_candidates(query, row.lang, settings.discovery_candidates)
        n_found = len(cands)

        known = {r.url: r for r in db.scalars(select(Resource).where(Resource.url.in_(
            [f"https://www.youtube.com/watch?v={c['video_id']}" for c in cands])))} if cands else {}
        kept = []
        for c in cands:
            c["url"] = f"https://www.youtube.com/watch?v={c['video_id']}"
            existing = known.get(c["url"])
            if existing is not None and existing.status in BLOCKED:
                continue  # a curator removed it, or it no longer plays
            if c["live"] or not c.get("embeddable", True) or not (120 <= c["duration"] <= 5400):
                continue
            if _profane(f"{c['title']} {c['description'][:500]}"):
                continue
            kept.append(c)

        # Embedding pre-rank so captions and the LLM judge only see a shortlist.
        if kept:
            tv = embeddings.embed_one(f"{teach} {ctx}", "query")
            vecs = embeddings.embed([f"{c['title']}. {c['description'][:400]}" for c in kept], "passage")
            for c, v in zip(kept, vecs):
                c["sim"] = embeddings.cosine(tv, v)
            kept.sort(key=lambda c: -c["sim"])
        shortlist = kept[: settings.discovery_judge]

        trusted = {x for (x,) in db.execute(select(Resource.creator).where(
            Resource.status == "Active", Resource.creator != "", Resource.meta["origin"].astext.is_distinct_from("discovered")))}
        judged = []
        for c in shortlist:
            caps = fetch_captions(c["video_id"], ("hi", "en", "en-IN") if row.lang == "hi" else ("en", "en-IN", "hi")) or []
            transcript = " ".join(x["text"] for x in caps)[:4000]
            j = _judge(teach, ctx, c, transcript)
            if not j or not j.get("relevant"):
                continue
            score = max(0.0, min(1.0, float(j.get("score") or 0)))
            if score < settings.discovery_min_relevance:
                continue
            c.update(judge=j, relevance=score, captions=bool(caps))
            like_ratio = c["likes"] / c["views"] if c["views"] and c["likes"] else None
            eng = (min(1.0, like_ratio / 0.04) * 0.6 if like_ratio else 0.3) + min(0.4, math.log10(c["views"] + 1) / 15)
            c["reddit"] = reddit.mentions(c["video_id"])
            red = min(1.0, (c["reddit"] or {}).get("posts", 0) / 3) if c["reddit"] else 0.0
            w_red = 0.1 if reddit.enabled() else 0.0
            c["rank"] = ((0.45 * score + 0.15 * c.get("sim", 0) + 0.15 * min(1.0, eng) + 0.1 * c["captions"]
                          + 0.05 * (c["channel"] in trusted) + w_red * red) / (0.9 + w_red))
            c["like_ratio"] = round(like_ratio, 4) if like_ratio else None
            judged.append(c)
        judged.sort(key=lambda c: -c["rank"])
        best = judged[: settings.discovery_max_results]

        ids: list[uuid.UUID] = []
        from app.services.resources import human_duration

        for c in best:
            r = known.get(c["url"])
            j = c["judge"]
            meta = {"origin": "discovered", "discovery_id": str(row.id), "relevance": round(c["relevance"], 3),
                    "rank": round(c["rank"], 3), "reason": str(j.get("reason", ""))[:300], "search": query,
                    "reddit": c["reddit"], "discovered_at": _now().isoformat(), "source": source}
            if r is None:
                ch = topic.chapter if topic else None
                r = Resource(
                    url=c["url"], title=c["title"][:400], platform="YouTube", rtype="Video", creator=c["channel"][:200],
                    duration_seconds=c["duration"], duration_label=human_duration(c["duration"]), thumbnail_url=c["thumbnail"][:1000],
                    description=c["description"], class_level=row.class_level, subject_id=ch.subject_id if ch else None,
                    chapter_id=ch.id if ch else None, languages=_lang_label(j.get("language", ""), c.get("language", ""), row.lang),
                    difficulty=j.get("difficulty") if j.get("difficulty") in ("Beginner", "Intermediate", "Advanced") else "Beginner",
                    status="Active", last_checked_at=_now(), check_ok=True, meta=meta,
                    signal={"views": c["views"], "likes": c["likes"], "comments": c["comments"], "like_ratio": c["like_ratio"],
                            "updated_at": _now().isoformat()})
                db.add(r)
                db.flush()
            elif (r.meta or {}).get("origin") == "discovered":
                r.meta = {**(r.meta or {}), **meta}
            if topic and not db.get(ResourceTopic, (r.id, topic.id)):
                db.add(ResourceTopic(resource_id=r.id, topic_id=topic.id))
            ids.append(r.id)
        row.resource_ids = ids
        row.status = "done"
        row.stats = {"source": source, "found": n_found, "passed_filters": len(kept), "judged": len(shortlist),
                     "relevant": len(judged), "added": len(ids), "reddit": reddit.enabled(), "search": query}
        row.updated_at = _now()
        db.commit()
        from app.services import search

        search.safe_reindex(db)
    except LLMError as e:
        db.rollback()
        row = db.get(VideoDiscovery, discovery_id)
        row.status, row.error = "failed", f"The AI model is unavailable: {e}"[:1000]
        db.commit()
    except Exception as e:  # noqa: BLE001 - network, quota, yt-dlp changes: record and retry later
        log.warning("Video discovery %s failed: %s", discovery_id, e)
        db.rollback()
        row = db.get(VideoDiscovery, discovery_id)
        row.status, row.error = "failed", str(e)[:1000]
        db.commit()
    return row
