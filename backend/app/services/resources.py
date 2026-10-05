"""Learning resources: metadata detection, classification, link checks, the
YouTube engagement signal and the recommendation engine (architecture v2).

Signals, strongest first once there is real usage: your own students'
behaviour (completion, helpful votes, co-completion), then YouTube's own
engagement (likes, views, comment sentiment), then curator quality ratings."""
import html
import logging
import re
import uuid
from collections import Counter, defaultdict
from datetime import datetime, timezone

import httpx
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.config import settings
from app.models import (
    Chapter,
    Resource,
    ResourceFeedback,
    ResourceProgress,
    ResourceTopic,
    StudentProfile,
    Topic,
    TopicProgress,
)
from app.services import embeddings, llm, parsing
from app.services.llm import LLMError, arr, obj

log = logging.getLogger(__name__)
UA = {"User-Agent": "Mozilla/5.0 (IntelliNova resource checker)"}


def human_duration(sec: int | None) -> str:
    if not sec:
        return ""
    h, m = divmod(int(sec) // 60, 60)
    return f"{h} h {m:02d} m" if h else f"{m} min"


def _iso_dur(s: str) -> int:
    m = re.match(r"P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?", s or "")
    if not m:
        return 0
    d, h, mi, se = (int(x or 0) for x in m.groups())
    return d * 86400 + h * 3600 + mi * 60 + se


# --------------------------------------------------------------------------- metadata


def detect(url: str) -> dict:
    url = url.strip()
    if not re.match(r"^https?://", url):
        url = "https://" + url
    if parsing.is_youtube(url):
        try:
            return _detect_youtube(url)
        except Exception as e:  # noqa: BLE001
            log.warning("YouTube metadata failed for %s: %s", url, e)
            return {"url": url, "platform": "YouTube", "available": False, "title": "", "error": str(e)[:200]}
    return _detect_web(url)


def _detect_youtube(url: str) -> dict:
    vid, pid = parsing.youtube_ids(url)
    is_pl = bool(pid and not vid) or "playlist" in url
    if settings.youtube_api_key:
        from googleapiclient.discovery import build

        yt = build("youtube", "v3", developerKey=settings.youtube_api_key, cache_discovery=False)
        if is_pl:
            pl = yt.playlists().list(part="snippet,contentDetails", id=pid).execute().get("items", [])
            if not pl:
                return {"url": url, "platform": "YouTube", "rtype": "Playlist", "available": False, "title": ""}
            sn = pl[0]["snippet"]
            items = yt.playlistItems().list(part="contentDetails", playlistId=pid, maxResults=50).execute()
            ids = [i["contentDetails"]["videoId"] for i in items.get("items", [])]
            total = 0
            stats = {"views": 0, "likes": 0, "comments": 0}
            if ids:
                vids = yt.videos().list(part="contentDetails,statistics", id=",".join(ids)).execute()
                for v in vids.get("items", []):
                    total += _iso_dur(v["contentDetails"]["duration"])
                    for k, sk in (("views", "viewCount"), ("likes", "likeCount"), ("comments", "commentCount")):
                        stats[k] += int(v.get("statistics", {}).get(sk, 0))
            n = pl[0]["contentDetails"]["itemCount"]
            return {"url": url, "platform": "YouTube", "rtype": "Playlist", "available": True,
                    "title": sn["title"], "creator": sn.get("channelTitle", ""), "description": sn.get("description", "")[:2000],
                    "thumbnail_url": (sn.get("thumbnails", {}).get("high") or {}).get("url", ""),
                    "duration_seconds": total, "duration_label": f"{n} videos · {human_duration(total)}",
                    "languages": [sn.get("defaultLanguage")] if sn.get("defaultLanguage") else [], "stats": stats}
        items = yt.videos().list(part="snippet,contentDetails,statistics,status", id=vid).execute().get("items", [])
        if not items:
            return {"url": url, "platform": "YouTube", "rtype": "Video", "available": False, "title": ""}
        v = items[0]
        sn, st = v["snippet"], v.get("statistics", {})
        dur = _iso_dur(v["contentDetails"]["duration"])
        return {"url": url, "platform": "YouTube", "rtype": "Video", "available": v["status"].get("privacyStatus") != "private",
                "title": sn["title"], "creator": sn.get("channelTitle", ""), "description": sn.get("description", "")[:2000],
                "thumbnail_url": (sn.get("thumbnails", {}).get("high") or {}).get("url", ""),
                "duration_seconds": dur, "duration_label": human_duration(dur),
                "languages": [x for x in {sn.get("defaultAudioLanguage"), sn.get("defaultLanguage")} if x],
                "stats": {"views": int(st.get("viewCount", 0)), "likes": int(st.get("likeCount", 0)),
                          "comments": int(st.get("commentCount", 0))}}
    # No API key: yt-dlp reads the public page.
    vids = parsing.list_videos(url)
    if is_pl:
        with parsing._ydl({"extract_flat": True}) as y:
            info = y.extract_info(url, download=False)
        total = sum(v.get("duration") or 0 for v in vids)
        return {"url": url, "platform": "YouTube", "rtype": "Playlist", "available": bool(vids),
                "title": info.get("title") or "", "creator": info.get("uploader") or info.get("channel") or "",
                "description": (info.get("description") or "")[:2000], "thumbnail_url": "",
                "duration_seconds": total, "duration_label": f"{len(vids)} videos · {human_duration(total)}",
                "languages": [], "stats": {}}
    with parsing._ydl({}) as y:
        info = y.extract_info(url, download=False)
    dur = int(info.get("duration") or 0)
    return {"url": url, "platform": "YouTube", "rtype": "Video", "available": True, "title": info.get("title") or "",
            "creator": info.get("uploader") or info.get("channel") or "", "description": (info.get("description") or "")[:2000],
            "thumbnail_url": info.get("thumbnail") or "", "duration_seconds": dur, "duration_label": human_duration(dur),
            "languages": [info["language"]] if info.get("language") else [],
            "stats": {"views": info.get("view_count") or 0, "likes": info.get("like_count") or 0,
                      "comments": info.get("comment_count") or 0}}


def _meta(html_text: str, prop: str) -> str:
    m = re.search(rf'<meta[^>]+(?:property|name)=["\']{re.escape(prop)}["\'][^>]+content=["\']([^"\']*)', html_text, re.I)
    if not m:
        m = re.search(rf'<meta[^>]+content=["\']([^"\']*)["\'][^>]+(?:property|name)=["\']{re.escape(prop)}["\']', html_text, re.I)
    return html.unescape(m.group(1)).strip() if m else ""


def _detect_web(url: str) -> dict:
    try:
        with httpx.Client(timeout=15, follow_redirects=True, headers=UA) as c:
            r = c.get(url)
    except httpx.HTTPError as e:
        return {"url": url, "platform": "Web", "available": False, "title": "", "error": str(e)[:200]}
    host = (httpx.URL(url).host or "").removeprefix("www.")
    ctype = r.headers.get("content-type", "")
    if "pdf" in ctype or url.lower().endswith(".pdf"):
        return {"url": url, "platform": host, "rtype": "Document", "available": r.status_code < 400,
                "title": url.rsplit("/", 1)[-1], "creator": host, "description": "", "thumbnail_url": "",
                "duration_label": "", "languages": []}
    t = r.text[:400000]
    title = _meta(t, "og:title") or html.unescape((re.search(r"<title[^>]*>(.*?)</title>", t, re.S | re.I) or [None, ""])[1]).strip()
    words = len(re.sub(r"<[^>]+>", " ", t).split())
    return {"url": url, "platform": _meta(t, "og:site_name") or host, "rtype": "Article", "available": r.status_code < 400,
            "title": title[:400], "creator": _meta(t, "author") or _meta(t, "og:site_name") or host,
            "description": (_meta(t, "og:description") or _meta(t, "description"))[:2000],
            "thumbnail_url": _meta(t, "og:image"), "duration_label": f"{max(1, words // 220)} min read",
            "languages": [(re.search(r'<html[^>]+lang=["\']([a-zA-Z-]+)', t) or [None, ""])[1][:2]] if re.search(r'<html[^>]+lang=', t) else []}


def check_link(url: str) -> bool:
    try:
        with httpx.Client(timeout=15, follow_redirects=True, headers=UA) as c:
            if parsing.is_youtube(url):
                r = c.get("https://www.youtube.com/oembed", params={"url": url, "format": "json"})
                return r.status_code == 200
            r = c.head(url)
            if r.status_code in (405, 403):
                r = c.get(url)
            return r.status_code < 400
    except httpx.HTTPError:
        return False


# --------------------------------------------------------------------------- classification

CLASSIFY_SCHEMA = obj({
    "topics": arr(llm.INT), "difficulty": llm.S, "languages": arr(llm.S), "confidence": llm.N, "reason": llm.S,
})
LANG_NAMES = {"en": "English", "hi": "Hindi", "ta": "Tamil", "bn": "Bengali", "mr": "Marathi", "te": "Telugu"}


def classify(db: Session, meta: dict) -> dict:
    text = f"{meta.get('title', '')}\n{meta.get('creator', '')}\n{meta.get('description', '')[:1200]}"
    topics = list(db.scalars(select(Topic).join(Chapter).where(Chapter.disabled.is_(False))).all())
    if not topics:
        return {"subject_id": None, "chapter_id": None, "topic_ids": [], "class_level": "", "difficulty": "Beginner",
                "languages": [], "confidence": 0.0, "reason": "No curriculum yet. Add chapters and topics first."}
    tv = embeddings.embed([f"{t.name} — {t.chapter.name} — {t.chapter.subject.name} {t.chapter.subject.class_level}"
                           for t in topics], "passage")
    qv = embeddings.embed_one(text, "query")
    ranked = sorted(range(len(topics)), key=lambda i: -embeddings.cosine(qv, tv[i]))[:15]
    cands = "\n".join(f"{i}: {topics[i].name} — {topics[i].chapter.name} — {topics[i].chapter.subject.name} "
                      f"({topics[i].chapter.subject.board} {topics[i].chapter.subject.class_level})" for i in ranked)
    picked: list[int] = []
    difficulty, langs, conf, reason = "Beginner", [], 0.5, ""
    try:
        out = llm.chat(
            [{"role": "system", "content": "You classify a learning resource into a school syllabus. Pick the topic "
                                           "numbers it covers (only from the list), its difficulty (Beginner, "
                                           "Intermediate or Advanced), the language(s) it is taught in (English, "
                                           "Hindi, Hinglish, …), your confidence 0-1 and a one-line reason."},
             {"role": "user", "content": f"Resource:\n{text}\n\nCandidate topics:\n{cands}"}],
            task="classify_resource", schema=CLASSIFY_SCHEMA, temperature=0.0,
        )
        picked = [i for i in out.get("topics", []) if isinstance(i, int) and i in ranked]
        difficulty = out.get("difficulty") if out.get("difficulty") in ("Beginner", "Intermediate", "Advanced") else "Beginner"
        langs = [str(x) for x in out.get("languages", []) if str(x).strip()][:3]
        conf = float(out.get("confidence") or 0.5)
        reason = out.get("reason") or ""
    except LLMError as e:
        log.warning("Resource classification by embeddings only: %s", e)
        picked = ranked[:1]
        conf = 0.4
        reason = "Matched by title similarity (AI model unavailable)"
    if not picked:
        picked = ranked[:1]
        conf = min(conf, 0.4)
    ch = Counter(topics[i].chapter_id for i in picked).most_common(1)[0][0]
    chapter = db.get(Chapter, ch)
    subj = chapter.subject
    if not langs:
        langs = [LANG_NAMES.get(x[:2], x) for x in meta.get("languages", []) if x] or ["English"]
    return {"subject_id": str(subj.id), "subject": subj.name, "chapter_id": str(chapter.id), "chapter": chapter.name,
            "class_level": subj.class_level, "board": subj.board,
            "topic_ids": [str(topics[i].id) for i in picked if topics[i].chapter_id == ch],
            "topics": [topics[i].name for i in picked if topics[i].chapter_id == ch],
            "difficulty": difficulty, "languages": langs, "confidence": round(conf, 2), "reason": reason}


# --------------------------------------------------------------------------- YouTube engagement signal

POS = set("good great best excellent amazing helpful clear thanks thank awesome perfect love nice easy understood "
          "superb osm badhiya accha acha samajh".split())
NEG = set("bad worst confusing confused boring wrong waste useless unclear slow difficult error mistake galat".split())


def _sentiment(texts: list[str]) -> float | None:
    try:
        from transformers import pipeline

        clf = pipeline("sentiment-analysis", model="distilbert-base-uncased-finetuned-sst-2-english")
        res = clf([t[:500] for t in texts], truncation=True)
        return sum(1 for r in res if r["label"] == "POSITIVE") / len(res)
    except Exception:  # noqa: BLE001 - transformers not installed or model not downloaded
        pos = neg = 0
        for t in texts:
            w = set(re.findall(r"[a-z]+", t.lower()))
            pos += bool(w & POS)
            neg += bool(w & NEG)
        return pos / (pos + neg) if pos + neg else None


def refresh_signal(db: Session, r: Resource) -> dict:
    meta = detect(r.url) if parsing.is_youtube(r.url) else {}
    stats = meta.get("stats") or {}
    sig: dict = {"views": stats.get("views", 0), "likes": stats.get("likes", 0), "comments": stats.get("comments", 0)}
    if sig["views"]:
        sig["like_ratio"] = round(sig["likes"] / sig["views"], 4)
    vid, _ = parsing.youtube_ids(r.url)
    if settings.youtube_api_key and vid:
        try:
            from better_profanity import profanity
            from googleapiclient.discovery import build

            yt = build("youtube", "v3", developerKey=settings.youtube_api_key, cache_discovery=False)
            res = yt.commentThreads().list(part="snippet", videoId=vid, maxResults=100, order="relevance",
                                           textFormat="plainText").execute()
            texts = [i["snippet"]["topLevelComment"]["snippet"]["textDisplay"] for i in res.get("items", [])]
            clean = [t for t in texts if not profanity.contains_profanity(t)]
            if clean:
                sig["positive_share"] = _sentiment(clean)
                sig["comments_sampled"] = len(clean)
        except Exception as e:  # noqa: BLE001 - comments disabled, quota
            log.info("Comment signal skipped for %s: %s", r.url, e)
    sig["updated_at"] = datetime.now(timezone.utc).isoformat()
    r.signal = sig
    if meta and meta.get("available") is False:
        r.status = "Unavailable"
    return sig


# --------------------------------------------------------------------------- recommendations


def _lang_match(r: Resource, langs: list[str]) -> float:
    rl = {x.lower() for x in r.languages or []}
    pl = {x.lower() for x in langs}
    if not rl or not pl:
        return 0.5
    if rl & pl:
        return 1.0
    if "hinglish" in rl and pl & {"hindi", "english"}:
        return 0.8
    return 0.1


def recommend(db: Session, user_id: uuid.UUID, chapter_id: uuid.UUID | None = None,
              topic_id: uuid.UUID | None = None, limit: int = 6, resource_ids: list[uuid.UUID] | None = None) -> list[dict]:
    """Ranked resources with a plain-language reason for each."""
    q = select(Resource).where(Resource.status == "Active")
    if resource_ids is not None:
        q = q.where(Resource.id.in_(resource_ids))
    elif topic_id:
        q = q.join(ResourceTopic, ResourceTopic.resource_id == Resource.id).where(ResourceTopic.topic_id == topic_id)
    elif chapter_id:
        q = q.where(Resource.chapter_id == chapter_id)
    res = list(db.scalars(q).unique().all())
    if not res:
        return []
    prof = db.get(StudentProfile, user_id)
    langs = prof.languages if prof else []
    prefs = (prof.prefs if prof else {}) or {}

    ids = [r.id for r in res]
    rt = defaultdict(set)
    for rid, tid in db.execute(select(ResourceTopic.resource_id, ResourceTopic.topic_id).where(ResourceTopic.resource_id.in_(ids))):
        rt[rid].add(tid)
    chap_topics: list[uuid.UUID] = []
    if chapter_id:
        chap_topics = list(db.scalars(select(Topic.id).where(Topic.chapter_id == chapter_id, Topic.published.is_(True))))
    done = set(db.scalars(select(TopicProgress.topic_id).where(TopicProgress.user_id == user_id)))
    remaining = [t for t in chap_topics if t not in done]

    fb = defaultdict(lambda: [0, 0])
    for rid, h, n in db.execute(select(ResourceFeedback.resource_id, ResourceFeedback.helpful, func.count())
                                .where(ResourceFeedback.resource_id.in_(ids)).group_by(ResourceFeedback.resource_id, ResourceFeedback.helpful)):
        fb[rid][0 if h == "up" else 1] += n
    comp = defaultdict(lambda: [0, 0])
    for rid, st, n in db.execute(select(ResourceProgress.resource_id, ResourceProgress.status, func.count())
                                 .where(ResourceProgress.resource_id.in_(ids)).group_by(ResourceProgress.resource_id, ResourceProgress.status)):
        comp[rid][0] += n
        if st == "completed":
            comp[rid][1] += n
    # Item-item collaborative signal: completed by students who completed what this student completed.
    mine = set(db.scalars(select(ResourceProgress.resource_id).where(ResourceProgress.user_id == user_id,
                                                                     ResourceProgress.status == "completed")))
    co = Counter()
    if mine:
        peers = select(ResourceProgress.user_id).where(ResourceProgress.resource_id.in_(mine),
                                                       ResourceProgress.status == "completed", ResourceProgress.user_id != user_id)
        for (rid,) in db.execute(select(ResourceProgress.resource_id).where(ResourceProgress.user_id.in_(peers),
                                                                           ResourceProgress.status == "completed",
                                                                           ResourceProgress.resource_id.in_(ids))):
            co[rid] += 1
    max_co = max(co.values()) if co else 1
    durs = [r.duration_seconds for r in res if r.duration_seconds]
    shortest = min(durs) if durs else None

    scored = []
    for r in res:
        up, down = fb[r.id]
        helpful = (up + 1) / (up + down + 2)
        started, completed = comp[r.id]
        completion = (completed + 1) / (started + 2)
        cover = len(rt[r.id] & set(remaining)) / len(remaining) if remaining else (1.0 if rt[r.id] else 0.5)
        yt = r.signal or {}
        eng = min(1.0, (yt.get("like_ratio") or 0) / 0.04) * 0.6 + (yt.get("positive_share") or 0.5) * 0.4
        quality = {"High": 1.0, "Medium": 0.6, "Low": 0.25}.get(r.quality or "", 0.5)
        n_students = up + down + started
        w_students = min(1.0, n_students / 30)  # own-student signal takes over as usage grows
        score = (0.25 * cover + 0.15 * _lang_match(r, langs) + 0.15 * quality + 0.1 * eng
                 + w_students * (0.2 * helpful + 0.15 * completion) + (1 - w_students) * 0.1
                 + 0.1 * (co[r.id] / max_co if co else 0))
        if prefs.get("short") and r.duration_seconds and shortest and r.duration_seconds <= shortest * 1.2:
            score += 0.05
        if not prefs.get("hinglish", True) and "hinglish" in {x.lower() for x in r.languages or []}:
            score -= 0.15
        meta = r.meta or {}
        auto = meta.get("origin") == "discovered"
        if auto:  # curated picks first; auto-found ones ordered by how well the judge said they teach the topic
            score += -0.08 + 0.1 * float(meta.get("relevance") or 0)
        red = meta.get("reddit") or {}
        if red.get("posts"):
            score += 0.03 * min(1.0, red["posts"] / 3)
        why = ""
        if remaining and cover >= 0.99:
            why = f"Covers all {len(remaining)} topics left in your chapter"
        elif remaining and cover > 0:
            why = f"Covers {len(rt[r.id] & set(remaining))} of the {len(remaining)} topics ahead of you"
        elif shortest and r.duration_seconds == shortest:
            why = "Shortest route through this material"
        if co[r.id]:
            why = why or "Finished by students who studied what you studied"
        if up + down >= 5 and helpful >= 0.75:
            why = why or f"Marked helpful by {round(helpful * 100)}% of students who rated it"
        if _lang_match(r, langs) == 1.0 and langs and not why:
            why = f"Taught in {', '.join(x for x in r.languages if x.lower() in {lang.lower() for lang in langs})}, one of your languages"
        strong = bool(co[r.id]) or (up + down >= 5 and helpful >= 0.75)  # our own students' signal outranks everything
        if red.get("posts") and not strong:
            subs = red.get("subreddits") or []
            why = f"Recommended by students on r/{subs[0]}" if subs else "Recommended by students on Reddit"
        elif auto and not strong:
            why = f"Found on YouTube · {meta['reason']}" if meta.get("reason") else "Found on YouTube and checked against this topic"
        scored.append((score, r, why, sorted(rt[r.id])))
    scored.sort(key=lambda x: -x[0])
    return [{"resource": r, "score": round(s, 3), "why": w, "topic_ids": [str(t) for t in tids]} for s, r, w, tids in scored[:limit]]
