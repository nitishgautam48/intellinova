"""Turn raw sources into source-linked segments.

- Textbooks (PDF): Docling when installed (layout-aware), otherwise PyMuPDF.
  Pages without a text layer are OCR'd with Tesseract.
- Slide decks (PPTX): python-pptx, one segment per slide plus embedded images.
- Lecture videos: YouTube captions when available, otherwise faster-whisper
  (whisper.cpp's CTranslate2 port) on the audio. For uploaded videos, OpenCV
  detects board/slide changes and Tesseract reads the on-screen text.
- Figures from any source are captioned later by LLaVA (see ingestion.py).
"""
import io
import logging
import os
import re
import statistics
import subprocess
import tempfile
import threading
from dataclasses import dataclass, field
from urllib.parse import parse_qs, urlparse

from app.services import storage

log = logging.getLogger(__name__)


@dataclass
class Segment:
    kind: str  # Text | Transcript | Slide | Diagram
    text: str
    location: str
    page: int | None = None
    slide: int | None = None
    t_start: float | None = None
    t_end: float | None = None
    heading: str = ""
    image_path: str = ""
    labels: list[str] = field(default_factory=list)


@dataclass
class Figure:
    image_path: str
    location: str
    page: int | None = None
    slide: int | None = None
    t_start: float | None = None
    context: str = ""


@dataclass
class Parsed:
    segments: list[Segment]
    figures: list[Figure]
    size_label: str = ""
    title: str = ""
    videos: list[dict] = field(default_factory=list)


# --------------------------------------------------------------------------- helpers


def _words(s: str) -> int:
    return len(s.split())


def chunk_paragraphs(paras: list[str], max_words: int = 180) -> list[str]:
    out, cur = [], []
    for p in paras:
        p = p.strip()
        if not p:
            continue
        if cur and _words(" ".join(cur)) + _words(p) > max_words:
            out.append(" ".join(cur))
            cur = []
        if _words(p) > max_words:
            sents = re.split(r"(?<=[.!?।])\s+", p)
            buf: list[str] = []
            for s in sents:
                if buf and _words(" ".join(buf)) + _words(s) > max_words:
                    out.append(" ".join(buf))
                    buf = []
                buf.append(s)
            if buf:
                cur.append(" ".join(buf))
        else:
            cur.append(p)
    if cur:
        out.append(" ".join(cur))
    return out


def fmt_ts(sec: float) -> str:
    sec = int(sec)
    h, m, s = sec // 3600, (sec % 3600) // 60, sec % 60
    return f"{h}:{m:02d}:{s:02d}" if h else f"{m:02d}:{s:02d}"


def ocr_image(data: bytes) -> str:
    try:
        import pytesseract
        from PIL import Image

        langs = os.environ.get("TESSERACT_LANGS", "eng+hin")
        try:
            return pytesseract.image_to_string(Image.open(io.BytesIO(data)), lang=langs)
        except pytesseract.TesseractError:
            return pytesseract.image_to_string(Image.open(io.BytesIO(data)))
    except Exception as e:  # tesseract missing or unreadable image
        log.warning("OCR unavailable: %s", e)
        return ""


# --------------------------------------------------------------------------- PDF

FIG_RE = re.compile(r"^\s*((?:Fig(?:ure)?\.?|Table)\s*\d+(?:\.\d+)*)", re.I)


def parse_pdf(path: str) -> Parsed:
    if os.environ.get("PDF_PARSER", "auto") in ("auto", "docling"):
        try:
            return _parse_pdf_docling(path)
        except ImportError:
            pass
        except Exception as e:  # noqa: BLE001 - fall back to PyMuPDF on any Docling failure
            log.warning("Docling failed (%s); falling back to PyMuPDF", e)
    return _parse_pdf_pymupdf(path)


def _page_label(page, idx: int) -> str:
    try:
        lbl = page.get_label()
    except Exception:  # noqa: BLE001
        lbl = ""
    return lbl or str(idx + 1)


def _parse_pdf_pymupdf(path: str) -> Parsed:
    import pymupdf

    doc = pymupdf.open(path)
    segments: list[Segment] = []
    figures: list[Figure] = []
    sizes: list[float] = []
    pages_blocks = []
    for page in doc:
        d = page.get_text("dict")
        blocks = []
        for b in d.get("blocks", []):
            if b.get("type") != 0:
                continue
            text, bsizes = [], []
            for line in b.get("lines", []):
                t = "".join(s["text"] for s in line.get("spans", []))
                if t.strip():
                    text.append(t)
                    bsizes += [s["size"] for s in line.get("spans", []) if s["text"].strip()]
            if text:
                sz = max(bsizes) if bsizes else 0
                sizes.append(sz)
                blocks.append((" ".join(text).strip(), sz, b["bbox"]))
        pages_blocks.append(blocks)
    body = statistics.median(sizes) if sizes else 10

    for idx, page in enumerate(doc):
        label = _page_label(page, idx)
        pnum = int(label) if label.isdigit() else idx + 1
        blocks = pages_blocks[idx]
        if sum(len(b[0]) for b in blocks) < 30:
            pix = page.get_pixmap(dpi=200)
            text = ocr_image(pix.tobytes("png"))
            blocks = [(p.strip(), body, None) for p in re.split(r"\n\s*\n", text) if p.strip()]
        heading = ""
        paras: list[tuple[str, str]] = []
        captions: list[str] = []
        for text, sz, _ in blocks:
            if FIG_RE.match(text):
                captions.append(text)
            if sz >= body * 1.18 and _words(text) <= 14:
                heading = text
                continue
            paras.append((heading, text))
        # group by heading, then chunk
        groups: dict[str, list[str]] = {}
        for h, t in paras:
            groups.setdefault(h, []).append(t)
        for h, ts in groups.items():
            for ch in chunk_paragraphs(ts):
                segments.append(Segment("Text", ch, f"p. {label}", page=pnum, heading=h))
        # figures
        for n, img in enumerate(page.get_images(full=True)):
            try:
                info = doc.extract_image(img[0])
            except Exception:  # noqa: BLE001
                continue
            if info.get("width", 0) < 150 or info.get("height", 0) < 120:
                continue
            ext = "." + info.get("ext", "png")
            ip = storage.save_bytes(info["image"], ext, "figures")
            cap = captions[n] if n < len(captions) else ""
            m = FIG_RE.match(cap)
            loc = f"p. {label}" + (f" · {m.group(1).replace('Figure', 'Fig.')}" if m else "")
            figures.append(Figure(ip, loc, page=pnum, context=cap))
    return Parsed(segments, figures, size_label=f"{len(doc)} pages", title=(doc.metadata or {}).get("title") or "")


def _parse_pdf_docling(path: str) -> Parsed:
    from docling.document_converter import DocumentConverter  # optional dependency

    res = DocumentConverter().convert(path)
    d = res.document
    segments: list[Segment] = []
    figures: list[Figure] = []
    by_page: dict[int, list[tuple[str, str]]] = {}
    heading = ""
    for item in d.texts:
        prov = item.prov[0] if getattr(item, "prov", None) else None
        pg = prov.page_no if prov else 1
        label = str(getattr(item, "label", "")).lower()
        if "section_header" in label or "title" in label:
            heading = item.text
            continue
        by_page.setdefault(pg, []).append((heading, item.text))
    for pg, items in sorted(by_page.items()):
        groups: dict[str, list[str]] = {}
        for h, t in items:
            groups.setdefault(h, []).append(t)
        for h, ts in groups.items():
            for ch in chunk_paragraphs(ts):
                segments.append(Segment("Text", ch, f"p. {pg}", page=pg, heading=h))
    for pic in getattr(d, "pictures", []):
        prov = pic.prov[0] if pic.prov else None
        pg = prov.page_no if prov else None
        img = pic.get_image(d) if hasattr(pic, "get_image") else None
        if img is None:
            continue
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        cap = pic.caption_text(d) if hasattr(pic, "caption_text") else ""
        m = FIG_RE.match(cap or "")
        loc = f"p. {pg}" + (f" · {m.group(1)}" if m else "")
        figures.append(Figure(storage.save_bytes(buf.getvalue(), ".png", "figures"), loc, page=pg, context=cap))
    for tbl in getattr(d, "tables", []):
        prov = tbl.prov[0] if tbl.prov else None
        pg = prov.page_no if prov else None
        try:
            md = tbl.export_to_markdown(d)
        except Exception:  # noqa: BLE001
            continue
        segments.append(Segment("Diagram", md[:2000], f"p. {pg} · Table", page=pg, heading="Table"))
    pages = len(getattr(d, "pages", {}) or {}) or len(by_page)
    return Parsed(segments, figures, size_label=f"{pages} pages")


# --------------------------------------------------------------------------- PPTX


def parse_pptx(path: str) -> Parsed:
    from pptx import Presentation
    from pptx.enum.shapes import MSO_SHAPE_TYPE

    prs = Presentation(path)
    segments: list[Segment] = []
    figures: list[Figure] = []
    for i, slide in enumerate(prs.slides, start=1):
        title = ""
        if slide.shapes.title is not None and slide.shapes.title.has_text_frame:
            title = slide.shapes.title.text_frame.text.strip()
        lines: list[str] = []

        def walk(shapes):
            for sh in shapes:
                if sh.shape_type == MSO_SHAPE_TYPE.GROUP:
                    walk(sh.shapes)
                    continue
                if sh.has_text_frame and sh != slide.shapes.title:
                    for p in sh.text_frame.paragraphs:
                        t = "".join(r.text for r in p.runs).strip()
                        if t:
                            lines.append(t)
                if getattr(sh, "has_table", False) and sh.has_table:
                    for row in sh.table.rows:
                        lines.append(" | ".join(c.text.strip() for c in row.cells))
                if sh.shape_type == MSO_SHAPE_TYPE.PICTURE:
                    try:
                        img = sh.image
                        if img.size[0] >= 150 and img.size[1] >= 120:
                            ip = storage.save_bytes(img.blob, "." + img.ext, "figures")
                            figures.append(Figure(ip, f"Slide {i}", slide=i, context=title))
                    except Exception:  # noqa: BLE001
                        pass

        walk(slide.shapes)
        notes = ""
        if slide.has_notes_slide and slide.notes_slide.notes_text_frame is not None:
            notes = slide.notes_slide.notes_text_frame.text.strip()
        text = "\n".join(([title] if title else []) + lines + ([f"Notes: {notes}"] if notes else []))
        if text.strip():
            segments.append(Segment("Slide", text, f"Slide {i}", slide=i, heading=title, labels=lines[:8]))
    return Parsed(segments, figures, size_label=f"{len(prs.slides)} slides")


# --------------------------------------------------------------------------- video


def youtube_ids(url: str) -> tuple[str | None, str | None]:
    """Returns (video_id, playlist_id)."""
    u = urlparse(url.strip())
    host = (u.hostname or "").lower()
    q = parse_qs(u.query)
    vid = pid = None
    if host.endswith("youtu.be"):
        vid = u.path.strip("/").split("/")[0] or None
    elif "youtube.com" in host:
        if u.path == "/watch":
            vid = (q.get("v") or [None])[0]
        elif u.path.startswith(("/shorts/", "/embed/", "/live/")):
            vid = u.path.split("/")[2]
        pid = (q.get("list") or [None])[0]
    return vid, pid


def is_youtube(url: str) -> bool:
    v, p = youtube_ids(url)
    return bool(v or p)


def _ydl(opts: dict):
    import yt_dlp

    base = {"quiet": True, "no_warnings": True, "skip_download": True}
    base.update(opts)
    return yt_dlp.YoutubeDL(base)


def list_videos(url: str) -> list[dict]:
    """[{id, title, duration, url}] for a video or playlist URL."""
    vid, pid = youtube_ids(url)
    if pid and not vid or "playlist" in url:
        with _ydl({"extract_flat": True}) as y:
            info = y.extract_info(url, download=False)
        return [
            {"id": e.get("id"), "title": e.get("title") or "", "duration": e.get("duration") or 0,
             "url": f"https://www.youtube.com/watch?v={e.get('id')}"}
            for e in (info.get("entries") or []) if e and e.get("id")
        ]
    with _ydl({}) as y:
        info = y.extract_info(url, download=False)
    return [{"id": info.get("id"), "title": info.get("title") or "", "duration": info.get("duration") or 0,
             "url": info.get("webpage_url") or url}]


def youtube_captions(video_id: str, langs: tuple[str, ...] = ("en", "en-IN", "hi")) -> list[dict] | None:
    try:
        from youtube_transcript_api import YouTubeTranscriptApi
    except ImportError:
        return None
    try:
        if hasattr(YouTubeTranscriptApi, "get_transcript"):
            rows = YouTubeTranscriptApi.get_transcript(video_id, languages=list(langs))
            return [{"text": r["text"], "start": r["start"], "duration": r.get("duration", 0)} for r in rows]
        fetched = YouTubeTranscriptApi().fetch(video_id, languages=list(langs))
        return [{"text": s.text, "start": s.start, "duration": s.duration} for s in fetched.snippets]
    except Exception as e:  # noqa: BLE001 - captions disabled / private video
        log.info("No captions for %s: %s", video_id, e)
        return None


def download_audio(url: str) -> str:
    tmp = tempfile.mkdtemp(prefix="inn-audio-")
    with _ydl({"skip_download": False, "format": "bestaudio/best", "outtmpl": os.path.join(tmp, "%(id)s.%(ext)s")}) as y:
        info = y.extract_info(url, download=True)
        return y.prepare_filename(info)


_whisper = None
_whisper_lock = threading.Lock()


def whisper_model():
    """One shared faster-whisper model (lecture transcription and spoken questions). Loaded on first use."""
    global _whisper
    from faster_whisper import WhisperModel

    from app.config import settings

    with _whisper_lock:
        if _whisper is None:
            _whisper = WhisperModel(settings.whisper_model, device=settings.whisper_device, compute_type="int8")
    return _whisper


def whisper_transcribe(path: str) -> list[dict]:
    segs, _info = whisper_model().transcribe(path, vad_filter=True)
    return [{"text": s.text.strip(), "start": s.start, "duration": s.end - s.start} for s in segs]


def group_transcript(rows: list[dict], prefix: str, window: float = 50.0) -> list[Segment]:
    out: list[Segment] = []
    buf: list[str] = []
    start = None
    end = 0.0
    for r in rows:
        t = re.sub(r"\s+", " ", r["text"]).strip()
        if not t or t.startswith("[") and t.endswith("]"):
            continue
        if start is None:
            start = r["start"]
        buf.append(t)
        end = r["start"] + (r.get("duration") or 0)
        if end - start >= window and re.search(r"[.?!।]$", t) or end - start >= window * 1.6:
            out.append(Segment("Transcript", " ".join(buf), f"{prefix}{fmt_ts(start)}", t_start=start, t_end=end))
            buf, start = [], None
    if buf and start is not None:
        out.append(Segment("Transcript", " ".join(buf), f"{prefix}{fmt_ts(start)}", t_start=start, t_end=end))
    return out


def keyframes_ocr(video_path: str, prefix: str, every_s: float = 2.0, thresh: float = 0.35) -> tuple[list[Segment], list[Figure]]:
    """Board/slide change detection: sample frames, keep the ones that differ a
    lot from the last kept frame, OCR them, and hand them on as figures."""
    try:
        import cv2
    except ImportError:
        return [], []
    cap = cv2.VideoCapture(video_path)
    fps = cap.get(cv2.CAP_PROP_FPS) or 25
    step = int(fps * every_s)
    last_hist = None
    idx = 0
    segs: list[Segment] = []
    figs: list[Figure] = []
    while True:
        cap.set(cv2.CAP_PROP_POS_FRAMES, idx)
        ok, frame = cap.read()
        if not ok:
            break
        small = cv2.resize(frame, (320, 180))
        hist = cv2.calcHist([cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)], [0], None, [64], [0, 256])
        hist = cv2.normalize(hist, hist).flatten()
        changed = last_hist is None or cv2.compareHist(last_hist, hist, cv2.HISTCMP_BHATTACHARYYA) > thresh
        if changed:
            last_hist = hist
            t = idx / fps
            ok2, png = cv2.imencode(".png", frame)
            if ok2:
                data = png.tobytes()
                text = ocr_image(data).strip()
                if len(text) > 25:
                    segs.append(Segment("Slide", text, f"{prefix}{fmt_ts(t)}", t_start=t, heading="On-screen text"))
                if len(figs) < 40:
                    figs.append(Figure(storage.save_bytes(data, ".png", "frames"), f"{prefix}{fmt_ts(t)}", t_start=t,
                                       context=text[:200]))
        idx += step
    cap.release()
    return segs, figs


def parse_video_url(url: str, with_frames: bool = False) -> Parsed:
    vids = list_videos(url)
    if not vids:
        raise ValueError("No videos found at this link. It may be private or removed.")
    multi = len(vids) > 1
    segments: list[Segment] = []
    figures: list[Figure] = []
    total = 0
    failed = 0
    for k, v in enumerate(vids, start=1):
        prefix = f"Video {k} · " if multi else ""
        total += v.get("duration") or 0
        rows = youtube_captions(v["id"]) if v.get("id") else None
        audio = None
        if not rows:
            try:
                audio = download_audio(v["url"])
                rows = whisper_transcribe(audio)
            except Exception as e:  # noqa: BLE001
                log.warning("Could not transcribe %s: %s", v["url"], e)
                failed += 1
                continue
        segments += group_transcript(rows, prefix)
        if audio:
            try:
                os.remove(audio)
            except OSError:
                pass
    if not segments:
        raise ValueError("Source is private or has no captions, and the audio could not be transcribed.")
    h, m = divmod(total // 60, 60)
    size = (f"{len(vids)} videos · " if multi else "") + (f"{h} h {m} m" if h else f"{m} min")
    return Parsed(segments, figures, size_label=size, title=vids[0]["title"] if not multi else "",
                  videos=vids)


def parse_video_file(path: str) -> Parsed:
    rows = whisper_transcribe(path)
    segments = group_transcript(rows, "")
    frame_segs, figures = keyframes_ocr(path, "")
    dur = rows[-1]["start"] + rows[-1]["duration"] if rows else 0
    try:
        out = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of",
                              "default=nw=1:nk=1", path], capture_output=True, text=True, timeout=30)
        dur = float(out.stdout.strip() or dur)
    except (OSError, ValueError, subprocess.SubprocessError):
        pass
    return Parsed(segments + frame_segs, figures, size_label=f"{int(dur // 60)} min")


def parse_text(text: str) -> Parsed:
    paras = [p for p in re.split(r"\n\s*\n", text) if p.strip()]
    chunks = chunk_paragraphs(paras)
    segs = [Segment("Text", c, f"Paragraph {i}", heading="") for i, c in enumerate(chunks, start=1)]
    return Parsed(segs, [], size_label=f"{_words(text)} words")
