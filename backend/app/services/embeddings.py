"""Multilingual embeddings (sentence-transformers, multilingual-e5 by default).

e5 models expect "query: " / "passage: " prefixes; we add them here so callers
only say what they are embedding."""
import hashlib
import math
import re
import threading

import httpx

from app.config import settings

_model = None
_lock = threading.Lock()


def _st_model():
    global _model
    with _lock:
        if _model is None:
            from sentence_transformers import SentenceTransformer

            _model = SentenceTransformer(settings.embeddings_model, device="cpu")
    return _model


def _hash_embed(text: str) -> list[float]:
    """Deterministic bag-of-words hashing. Only for tests / offline dev: it
    captures word overlap, not meaning."""
    v = [0.0] * settings.embed_dim
    for tok in re.findall(r"\w+", text.lower()):
        h = int(hashlib.md5(tok.encode()).hexdigest(), 16)
        v[h % settings.embed_dim] += 1.0 if (h >> 8) & 1 else -1.0
    n = math.sqrt(sum(x * x for x in v)) or 1.0
    return [x / n for x in v]


def embed(texts: list[str], kind: str = "passage") -> list[list[float]]:
    if not texts:
        return []
    backend = settings.embeddings_backend
    if backend == "hash":
        return [_hash_embed(t) for t in texts]
    prefix = "query: " if kind == "query" else "passage: "
    is_e5 = "e5" in settings.embeddings_model.lower()
    inputs = [(prefix + t) if is_e5 else t for t in texts]
    if backend == "ollama":
        with httpx.Client(timeout=120) as c:
            r = c.post(f"{settings.ollama_url}/api/embed", json={"model": settings.embeddings_model, "input": inputs})
            r.raise_for_status()
            return r.json()["embeddings"]
    vecs = _st_model().encode(inputs, batch_size=32, normalize_embeddings=True, show_progress_bar=False)
    return [v.tolist() for v in vecs]


def embed_one(text: str, kind: str = "query") -> list[float]:
    return embed([text], kind)[0]


def cosine(a: list[float], b: list[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a)) or 1.0
    nb = math.sqrt(sum(y * y for y in b)) or 1.0
    return dot / (na * nb)
