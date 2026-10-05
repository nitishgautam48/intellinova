"""Slide deck (.pptx) from a study material's notes (problem statement 6b: "notes, slides, audio").

Built with python-pptx from the already-generated, source-linked notes, so the slides say exactly what the
notes say and each content slide keeps its source location in the footer."""
import io
import re

from pptx import Presentation
from pptx.dml.color import RGBColor
from pptx.enum.shapes import MSO_SHAPE
from pptx.util import Emu, Inches, Pt

PRI = RGBColor(0x12, 0x8A, 0x63)
PRI_SOFT = RGBColor(0xE3, 0xF4, 0xEC)
INK = RGBColor(0x1C, 0x24, 0x22)
INK2 = RGBColor(0x5A, 0x66, 0x62)
WARN_SOFT = RGBColor(0xFD, 0xF3, 0xDC)
W, H = Inches(13.333), Inches(7.5)
MAX_BULLETS = 6


def _sentences(text: str) -> list[str]:
    parts = [p.strip() for p in re.split(r"(?<=[.!?।])\s+", text or "") if p.strip()]
    return parts or [text]


def _box(slide, x, y, w, h, fill=None):
    shp = slide.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE if fill else MSO_SHAPE.RECTANGLE, x, y, w, h)
    shp.shadow.inherit = False
    if fill:
        shp.fill.solid()
        shp.fill.fore_color.rgb = fill
        shp.adjustments[0] = 0.08
    else:
        shp.fill.background()
    shp.line.fill.background()
    tf = shp.text_frame
    tf.word_wrap = True
    tf.margin_left = tf.margin_right = Inches(0.25)
    tf.margin_top = tf.margin_bottom = Inches(0.12)
    return tf


def _para(tf, text: str, size: int = 20, bold: bool = False, color=INK, first: bool = False, bullet: bool = False):
    p = tf.paragraphs[0] if first else tf.add_paragraph()
    run = p.add_run()
    run.text = ("•  " if bullet else "") + text
    run.font.size, run.font.bold = Pt(size), bold
    run.font.color.rgb = color
    p.space_after = Pt(8)
    return p


def _slide(prs, title: str, footer: str = ""):
    s = prs.slides.add_slide(prs.slide_layouts[6])
    bar = s.shapes.add_shape(MSO_SHAPE.RECTANGLE, 0, 0, W, Inches(0.18))
    bar.fill.solid()
    bar.fill.fore_color.rgb = PRI
    bar.line.fill.background()
    tf = _box(s, Inches(0.6), Inches(0.45), W - Inches(1.2), Inches(1.0))
    _para(tf, title, 32, True, INK, first=True)
    if footer:
        ft = _box(s, Inches(0.6), H - Inches(0.6), W - Inches(1.2), Inches(0.4))
        _para(ft, footer, 12, False, INK2, first=True)
    return s


def _bullets(prs, title: str, items: list[str], footer: str = "", fill=None, bullet: bool = True):
    for i in range(0, max(len(items), 1), MAX_BULLETS):
        chunk = items[i:i + MAX_BULLETS]
        s = _slide(prs, title + (" (cont.)" if i else ""), footer)
        tf = _box(s, Inches(0.6), Inches(1.55), W - Inches(1.2), H - Inches(2.4), fill)
        for j, x in enumerate(chunk):
            _para(tf, x, 20, first=j == 0, bullet=bullet)


def build(title: str, subtitle: str, o: dict) -> bytes:
    prs = Presentation()
    prs.slide_width, prs.slide_height = Emu(W), Emu(H)

    s = prs.slides.add_slide(prs.slide_layouts[6])
    bg = s.shapes.add_shape(MSO_SHAPE.RECTANGLE, 0, 0, W, H)
    bg.fill.solid()
    bg.fill.fore_color.rgb = PRI_SOFT
    bg.line.fill.background()
    tf = _box(s, Inches(0.9), Inches(2.4), W - Inches(1.8), Inches(2.6))
    _para(tf, title, 40, True, INK, first=True)
    if subtitle:
        _para(tf, subtitle, 20, False, INK2)
    _para(tf, "Made with IntelliNova Study AI from your class material", 14, False, PRI)

    if o.get("key_points"):
        _bullets(prs, "What matters most", o["key_points"], fill=PRI_SOFT)

    for sec in o.get("full", []):
        s = _slide(prs, sec["h"], f"Source: {sec['src']['loc']}" if sec.get("src") else "")
        y = Inches(1.55)
        body = _box(s, Inches(0.6), y, W - Inches(1.2), Inches(2.6))
        for j, x in enumerate(_sentences(sec["p"])[:MAX_BULLETS]):
            _para(body, x, 20, first=j == 0, bullet=True)
        y = Inches(4.3)
        if sec.get("def"):
            d = _box(s, Inches(0.6), y, (W - Inches(1.5)) / 2 if sec.get("ex") else W - Inches(1.2), Inches(1.9), PRI_SOFT)
            _para(d, sec["def"][0], 18, True, PRI, first=True)
            _para(d, sec["def"][1], 16)
        if sec.get("ex"):
            x0 = Inches(0.9) + (W - Inches(1.5)) / 2 if sec.get("def") else Inches(0.6)
            e = _box(s, x0, y, (W - Inches(1.5)) / 2 if sec.get("def") else W - Inches(1.2), Inches(1.9), WARN_SOFT)
            _para(e, "Example", 18, True, INK, first=True)
            _para(e, sec["ex"], 16)

    if o.get("formulas"):
        rows = o["formulas"][:10]
        s = _slide(prs, "Formulas")
        tbl = s.shapes.add_table(len(rows) + 1, 3, Inches(0.6), Inches(1.6), W - Inches(1.2), Inches(0.5) * (len(rows) + 1)).table
        for c, h in enumerate(["Quantity", "Formula", "Unit"]):
            tbl.cell(0, c).text = h
        for r, f in enumerate(rows, start=1):
            for c, v in enumerate([f.get("n", ""), f.get("f", ""), f.get("u", "")]):
                tbl.cell(r, c).text = v or "—"
                tbl.cell(r, c).text_frame.paragraphs[0].runs[0].font.size = Pt(16)

    if o.get("confusions"):
        _bullets(prs, "Don't mix these up", [f"{c['a']}: {c['b']}" for c in o["confusions"]], fill=WARN_SOFT)
    if o.get("short"):
        _bullets(prs, "Quick recap", o["short"])
    if o.get("revision"):
        _bullets(prs, "Check yourself", [f"☐  {x}" for x in o["revision"]], "Tick each one you can do without looking at your notes.", bullet=False)

    buf = io.BytesIO()
    prs.save(buf)
    return buf.getvalue()
