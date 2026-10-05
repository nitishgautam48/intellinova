"""Cache-first reads (architecture v2): answer from Redis when possible, and let
only one worker recompute an expired key (python-redis-lock) so a popular
query can't stampede the database or the LLM."""
import json
import logging
from collections.abc import Callable
from typing import Any

import redis
import redis_lock

from app.config import settings

log = logging.getLogger(__name__)
_client: redis.Redis | None = None


def client() -> redis.Redis:
    global _client
    if _client is None:
        _client = redis.Redis.from_url(settings.redis_url, decode_responses=True)
    return _client


def get(key: str) -> Any:
    try:
        v = client().get(key)
    except redis.RedisError:
        return None
    return json.loads(v) if v else None


def set(key: str, value: Any, ttl: int = 300) -> None:  # noqa: A001
    try:
        client().set(key, json.dumps(value, default=str), ex=ttl)
    except redis.RedisError:
        pass


def delete_prefix(prefix: str) -> None:
    try:
        c = client()
        for k in c.scan_iter(f"{prefix}*"):
            c.delete(k)
    except redis.RedisError:
        pass


def cached(key: str, ttl: int, compute: Callable[[], Any]) -> Any:
    hit = get(key)
    if hit is not None:
        return hit
    try:
        lock = redis_lock.Lock(client(), f"lock:{key}", expire=60, auto_renewal=True)
    except redis.RedisError:
        return compute()
    try:
        if lock.acquire(timeout=30):
            try:
                hit = get(key)
                if hit is not None:
                    return hit
                value = compute()
                set(key, value, ttl)
                return value
            finally:
                try:
                    lock.release()
                except redis_lock.NotAcquired:
                    pass
    except redis.RedisError:
        pass
    return compute()
