import os
import uuid
from datetime import datetime
from pathlib import Path

from fastapi import HTTPException, UploadFile

from app.config import settings

MAX_UPLOAD = 200 * 1024 * 1024
ALLOWED = {
    ".pdf": "application/pdf",
    ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ".mp4": "video/mp4",
    ".webm": "video/webm",
    ".mkv": "video/x-matroska",
    ".mov": "video/quicktime",
    ".mp3": "audio/mpeg",
    ".m4a": "audio/mp4",
    ".wav": "audio/wav",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".txt": "text/plain",
}


def root() -> Path:
    p = Path(settings.storage_dir)
    p.mkdir(parents=True, exist_ok=True)
    return p


def new_path(ext: str, sub: str = "files") -> Path:
    d = root() / sub / datetime.utcnow().strftime("%Y/%m")
    d.mkdir(parents=True, exist_ok=True)
    return d / f"{uuid.uuid4().hex}{ext}"


def save_upload(f: UploadFile, allowed: set[str] | None = None) -> tuple[str, str, int]:
    ext = os.path.splitext(f.filename or "")[1].lower()
    ok = allowed or set(ALLOWED)
    if ext not in ok:
        raise HTTPException(400, f"Unsupported file type {ext or '(none)'}. Use one of: {', '.join(sorted(ok))}")
    dest = new_path(ext)
    size = 0
    with open(dest, "wb") as out:
        while chunk := f.file.read(1024 * 1024):
            size += len(chunk)
            if size > MAX_UPLOAD:
                out.close()
                dest.unlink(missing_ok=True)
                raise HTTPException(413, "File is larger than 200 MB")
            out.write(chunk)
    return str(dest), ALLOWED.get(ext, "application/octet-stream"), size


def save_bytes(data: bytes, ext: str, sub: str = "derived") -> str:
    dest = new_path(ext, sub)
    dest.write_bytes(data)
    return str(dest)


def safe_path(path: str) -> Path:
    p = Path(path).resolve()
    if not str(p).startswith(str(root().resolve())):
        raise HTTPException(404)
    if not p.exists():
        raise HTTPException(404, "File not found")
    return p
