"""Text-to-speech for audio tutoring and audio briefs, with Piper (open, runs on CPU).

Voices (.onnx + .onnx.json) live in PIPER_VOICE_DIR. With PIPER_AUTO_DOWNLOAD on (the default), an
English and a Hindi voice are downloaded once from the open piper-voices collection into the models
volume, in the background. Until a voice is ready, the web app uses the browser's speech."""
import io
import logging
import threading
import wave
from pathlib import Path

import httpx

from app.config import settings

log = logging.getLogger(__name__)
_voices: dict[str, object] = {}
_lock = threading.Lock()
_download_started = False

VOICE_BASE = "https://huggingface.co/rhasspy/piper-voices/resolve/main"
# First that downloads wins. Each is ~60 MB.
VOICE_CHOICES = {
    "en": ["en/en_US/lessac/medium/en_US-lessac-medium", "en/en_US/amy/medium/en_US-amy-medium"],
    "hi": ["hi/hi_IN/pratham/medium/hi_IN-pratham-medium", "hi/hi_IN/priyamvada/medium/hi_IN-priyamvada-medium",
           "hi/hi_IN/rohan/medium/hi_IN-rohan-medium"],
}


def _fetch(url: str, dest: Path) -> None:
    tmp = dest.with_suffix(dest.suffix + ".part")
    with httpx.stream("GET", url, follow_redirects=True, timeout=120) as r:
        r.raise_for_status()
        with open(tmp, "wb") as f:
            for chunk in r.iter_bytes(1 << 16):
                f.write(chunk)
    tmp.replace(dest)


def download_voices() -> dict[str, str | None]:
    """Downloads any missing English/Hindi voice. Returns lang -> installed file name (or None)."""
    d = Path(settings.piper_voice_dir)
    d.mkdir(parents=True, exist_ok=True)
    out: dict[str, str | None] = {}
    for lang, choices in VOICE_CHOICES.items():
        have = _voice_file(lang)
        if have:
            out[lang] = have.name
            continue
        out[lang] = None
        for path in choices:
            name = path.rsplit("/", 1)[-1]
            try:
                _fetch(f"{VOICE_BASE}/{path}.onnx.json", d / f"{name}.onnx.json")
                _fetch(f"{VOICE_BASE}/{path}.onnx", d / f"{name}.onnx")
                out[lang] = f"{name}.onnx"
                log.info("Downloaded Piper voice %s", name)
                break
            except Exception as e:  # noqa: BLE001
                log.warning("Could not download Piper voice %s: %s", name, e)
                for f in (d / f"{name}.onnx", d / f"{name}.onnx.json"):
                    f.unlink(missing_ok=True)
    return out


def ensure_voices_async() -> None:
    """Starts the one-time voice download in the background (never blocks a request)."""
    global _download_started
    if _download_started or not settings.piper_auto_download:
        return
    try:
        import piper  # noqa: F401
    except ImportError:
        return
    if all(_voice_file(lang) for lang in VOICE_CHOICES):
        return
    _download_started = True
    threading.Thread(target=download_voices, name="piper-voices", daemon=True).start()


def _voice_file(lang: str) -> Path | None:
    d = Path(settings.piper_voice_dir)
    if not d.exists():
        return None
    prefix = "hi_" if lang == "hi" else "en_"
    for p in sorted(d.glob("*.onnx")):
        if not (p.parent / f"{p.name}.json").exists():
            continue
        if p.name.startswith(prefix):
            return p
    return None


def available(lang: str) -> bool:
    try:
        import piper  # noqa: F401
    except ImportError:
        return False
    return _voice_file(lang) is not None


def synthesize(text: str, lang: str = "en") -> bytes | None:
    try:
        from piper import PiperVoice
    except ImportError:
        return None
    path = _voice_file(lang)
    if path is None:
        return None
    with _lock:
        voice = _voices.get(str(path))
        if voice is None:
            voice = PiperVoice.load(str(path))
            _voices[str(path)] = voice
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wf:
        if hasattr(voice, "synthesize_wav"):
            voice.synthesize_wav(text[:4000], wf)
        else:
            voice.synthesize(text[:4000], wf)
    return buf.getvalue()
