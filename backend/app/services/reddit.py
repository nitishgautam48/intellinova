"""Optional community signal from Reddit (architecture v2: never load-bearing).

Reddit's free Data API tier is for non-commercial use with a 100 requests/minute limit, so this is only
active when REDDIT_CLIENT_ID and REDDIT_CLIENT_SECRET are set, results are cached for a day, and every
failure simply means "no signal". It counts posts in study subreddits that link to a given video."""
import logging
import time

import httpx

from app.config import settings
from app.services import cache

log = logging.getLogger(__name__)
_token: dict = {"value": "", "expires": 0.0}


def enabled() -> bool:
    return bool(settings.reddit_client_id and settings.reddit_client_secret)


def _access_token(client: httpx.Client) -> str:
    if _token["value"] and _token["expires"] > time.time() + 60:
        return _token["value"]
    r = client.post("https://www.reddit.com/api/v1/access_token", data={"grant_type": "client_credentials"},
                    auth=(settings.reddit_client_id, settings.reddit_client_secret))
    r.raise_for_status()
    body = r.json()
    _token.update(value=body["access_token"], expires=time.time() + float(body.get("expires_in", 3600)))
    return _token["value"]


def _search(video_id: str) -> dict:
    headers = {"User-Agent": settings.reddit_user_agent}
    with httpx.Client(timeout=10, headers=headers) as c:
        tok = _access_token(c)
        r = c.get(f"https://oauth.reddit.com/r/{settings.reddit_subreddits}/search",
                  params={"q": video_id, "restrict_sr": 1, "limit": 25, "sort": "relevance", "t": "all", "type": "link"},
                  headers={"Authorization": f"bearer {tok}"})
        r.raise_for_status()
        posts = [ch["data"] for ch in r.json().get("data", {}).get("children", [])]
    hits = [p for p in posts if video_id in (p.get("url") or "") or video_id in (p.get("selftext") or "")]
    return {"posts": len(hits), "upvotes": sum(max(0, int(p.get("score") or 0)) for p in hits),
            "subreddits": sorted({p.get("subreddit", "") for p in hits if p.get("subreddit")})[:3]}


def mentions(video_id: str) -> dict | None:
    """{posts, upvotes, subreddits} for a YouTube video id, or None when Reddit is off or unreachable."""
    if not enabled() or not video_id:
        return None
    try:
        return cache.cached(f"reddit:yt:{video_id}", 86400, lambda: _search(video_id))
    except Exception as e:  # noqa: BLE001 - optional signal: any failure means "no signal"
        log.info("Reddit signal skipped for %s: %s", video_id, e)
        return None
