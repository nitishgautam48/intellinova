"""Speech to text for spoken questions (problem statement 6e), with the same faster-whisper model used to
transcribe lectures. Runs on the server, so voice input works in every browser (not just Chrome's cloud
speech service) and nothing leaves the machine. faster-whisper decodes webm/opus, ogg, mp4/aac and wav
itself through PyAV, so no separate ffmpeg install is needed."""
import logging
import os
import tempfile
import threading

log = logging.getLogger(__name__)
_lock = threading.Lock()  # one transcription at a time keeps CPU/GPU use predictable on a laptop
MAX_BYTES = 8 * 1024 * 1024
MAX_SECONDS = 60
# Nudges Whisper towards school vocabulary and mixed Hindi/English without forcing a language.
PROMPT = {"en": "A school student asks a question about their lesson.",
          "hing": "Student ka sawaal, Hinglish mein: current, resistance, photosynthesis ke baare mein.",
          "hi": "छात्र अपने पाठ के बारे में प्रश्न पूछता है।"}


def available() -> bool:
    import importlib.util

    return importlib.util.find_spec("faster_whisper") is not None


def transcribe(data: bytes, lang: str = "en", suffix: str = ".webm") -> dict:
    from app.services import parsing

    fd, path = tempfile.mkstemp(suffix=suffix)
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(data)
        with _lock:
            segs, info = parsing.whisper_model().transcribe(
                path, language={"en": "en", "hi": "hi"}.get(lang), vad_filter=True, beam_size=1,
                initial_prompt=PROMPT.get(lang, PROMPT["en"]), condition_on_previous_text=False,
                clip_timestamps=[0, MAX_SECONDS])
            text = " ".join(s.text.strip() for s in segs).strip()
        return {"text": text, "language": info.language, "duration": round(float(info.duration), 1)}
    finally:
        try:
            os.remove(path)
        except OSError:
            pass
