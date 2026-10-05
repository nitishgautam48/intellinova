"""Answer-quality settings and evaluation helpers that need no services: reasoning-model output, Ollama
options, citation matching, test-set import, report export, voice download and re-ranking switches."""
import csv
import io
import json
from datetime import datetime, timezone
from pathlib import Path

import pytest

from app.config import settings
from app.models import EvalRun
from app.services import evaluation, llm, retrieval, tts


def test_reasoning_model_thinking_is_dropped():
    assert llm.strip_thinking("<think>Let me work it out…</think>\nV = IR.") == "V = IR."
    assert llm.strip_thinking("Answer first. <THINK>cut off by the token lim") == "Answer first."
    assert llm.strip_thinking("No thinking here.") == "No thinking here."
    assert llm._extract_json('<think>{"draft": 1}</think>```json\n{"score": 0.9}\n```') == {"score": 0.9}


def test_ollama_gets_a_context_window_that_fits_our_prompts():
    o = llm.options_for("llama3.1:8b", 0.2, 300)
    assert o == {"temperature": 0.2, "num_ctx": settings.llm_num_ctx, "num_predict": 300}
    assert settings.llm_num_ctx >= 8192 and "num_predict" not in llm.options_for("m", 0.0, None)


@pytest.mark.parametrize(("exp", "got", "match"), [
    ("p. 2", "p. 2", True),
    ("p. 2", "p. 2 · Fig. 11.1", True),
    ("Page 2", "p. 2", True),
    ("p. 1", "p. 12", False),
    ("p. 12", "p. 1", False),
    ("Slide 4", "Slide 41", False),
    ("Video 1 · 03:20", "Video 1 · 03:20", True),
    ("p. 3", "p. 4", False),
])
def test_citation_locations_match_by_whole_number(exp, got, match):
    assert evaluation._loc_match(evaluation._norm_loc(exp), evaluation._norm_loc(got)) is match


def test_test_set_csv_and_json_import():
    sample = Path(__file__).resolve().parents[2] / "samples" / "eval-testset-electricity.csv"
    if sample.exists():
        rows = evaluation.parse_cases(sample.read_bytes(), sample.name)
        assert len(rows) >= 20 and sum(r["off_material"] for r in rows) >= 3
        assert all(r["expected_locations"] for r in rows if not r["off_material"])

    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["Question", "expected_answer", "expected_locations", "category", "off_material"])
    w.writerow(["State Ohm's law.", "V = IR", "p. 2; Slide 4", "Textbook page", "no"])
    w.writerow(["", "", "", "", ""])  # blank rows are ignored
    w.writerow(["Who won the 2011 World Cup?", "", "", "", "yes"])
    rows = evaluation.parse_cases(("﻿" + buf.getvalue()).encode(), "set.csv")  # Excel's BOM
    assert [r["expected_locations"] for r in rows] == [["p. 2", "Slide 4"], []]
    assert [r["off_material"] for r in rows] == [False, True]

    js = json.dumps([{"question": "Define electric power.", "expected_locations": ["p. 4"], "category": "Textbook page"}])
    assert evaluation.parse_cases(js.encode(), "set.json")[0]["expected_locations"] == ["p. 4"]

    with pytest.raises(ValueError, match="category"):
        evaluation.parse_cases(b"question,category\nWhat is current?,Podcast\n", "x.csv")
    with pytest.raises(ValueError, match="No questions"):
        evaluation.parse_cases(b"q,a\nfoo,bar\n", "x.csv")
    with pytest.raises(ValueError, match="list"):
        evaluation.parse_cases(b'{"question": "x"}', "x.json")


def _run() -> EvalRun:
    when = datetime(2026, 10, 4, 12, 0, tzinfo=timezone.utc)
    cases = [
        {"q": "State Ohm's law.", "category": "Textbook page", "off": False, "status": "answered", "expected": ["p. 2"],
         "cited": ["p. 2"], "faith": 1.0, "relev": 0.9, "cprec": 0.8, "crec": 1.0, "cite": 1.0, "latency_s": 3.2,
         "answer": "V = IR [1]", "reference": "V = IR"},
        {"q": "Who won the 2011 World Cup?", "category": "Textbook page", "off": True, "status": "declined", "expected": [],
         "cited": [], "faith": None, "relev": None, "cprec": None, "crec": None, "cite": None, "latency_s": 1.1,
         "answer": "", "reference": ""},
    ]
    return EvalRun(number=7, framework="RAGAS", status="completed", pipeline_version="pipe-1", created_at=when, finished_at=when,
                   metrics={"values": {"faith": 1.0, "relev": 0.9, "cprec": 0.8, "crec": 1.0, "cite": 1.0, "refuse": 1.0},
                            "targets": evaluation.TARGETS, "engine": "ragas", "engine_note": "", "n_cases": 2, "n_off": 1,
                            "n_off_handled": 1, "cases": cases,
                            "extra": {"answered": 1.0, "latency_avg_s": 2.2, "latency_p90_s": 3.2,
                                      "models": {"answer": "llama3.1:8b", "judge": "qwen2.5:7b"}}},
                   categories=[{"l": "Textbook page", "n": 1, "faith": 1.0, "relev": 0.9, "cprec": 0.8, "crec": 1.0}],
                   failures=[], question_bank={"generated": 10, "verified": 8, "disagreement": 1, "rejected": 1, "duplicate": 0},
                   simulation=None)


def test_reports_have_every_question():
    run = _run()
    md = evaluation.report_markdown(run)
    assert md.startswith("# IntelliNova evaluation report: run 7")
    assert "State Ohm's law." in md and "Who won the 2011 World Cup?" in md and "ragas" in md
    assert "answers `llama3.1:8b`" in md and "near-duplicates removed 0" in md and "| Faithfulness | 1.00 | 0.85 | yes |" in md
    rows = list(csv.DictReader(io.StringIO(evaluation.report_csv(run))))
    assert len(rows) == 2 and rows[0]["question"] == "State Ohm's law." and rows[1]["status"] == "declined"
    assert float(rows[0]["faithfulness"]) == 1.0


def test_piper_voices_download_once(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "piper_voice_dir", str(tmp_path))
    fetched = []

    def fake_fetch(url, dest):
        fetched.append(url.rsplit("/", 1)[-1])
        if "pratham" in url:  # first Hindi choice unavailable: falls back to the next voice
            raise OSError("404")
        dest.write_bytes(b"{}" if dest.name.endswith(".json") else b"onnx")

    monkeypatch.setattr(tts, "_fetch", fake_fetch)
    out = tts.download_voices()
    assert out == {"en": "en_US-lessac-medium.onnx", "hi": "hi_IN-priyamvada-medium.onnx"}
    assert not list(tmp_path.glob("*pratham*"))
    n = len(fetched)
    assert tts.download_voices() == out and len(fetched) == n  # already installed: nothing fetched again


def test_a_voice_without_its_config_is_not_used(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "piper_voice_dir", str(tmp_path))
    (tmp_path / "en_US-lessac-medium.onnx").write_bytes(b"x")
    assert tts._voice_file("en") is None
    (tmp_path / "en_US-lessac-medium.onnx.json").write_text("{}")
    assert tts._voice_file("en").name == "en_US-lessac-medium.onnx"


def test_reranking_can_be_switched_off(monkeypatch):
    monkeypatch.setattr(settings, "rerank_model", "")
    assert retrieval.rerank_scores("What is current?", ["Current is the flow of charge."]) is None
    monkeypatch.setattr(settings, "rerank_model", "some/model")
    assert retrieval.rerank_scores("q", []) is None
