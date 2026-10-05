"""Deterministic stand-ins for the local LLM, keyed by task name.

They read the same prompts the real model gets, so the whole pipeline
(parsing, tagging, retrieval SQL, grounding, question verification, grading,
learner model, notes) runs for real; only text generation is scripted."""
import re

from app.services import llm

WORD = re.compile(r"[a-zA-Z']{3,}")
STOP = set("the and for are with that this from what does which into when your have their about there these those".split())
_keys: dict[str, str] = {}


def words(s: str) -> set[str]:
    return {w.lower().strip("'") for w in WORD.findall(s)} - STOP


def last_user(messages: list[dict]) -> str:
    return next(m["content"] for m in reversed(messages) if m["role"] == "user")


def excerpts(text: str) -> dict[int, str]:
    out: dict[int, str] = {}
    for m in re.finditer(r"\[(\d+)\] (.*?)(?=\n\n\[\d+\] |\n\nQuestion:|\Z)", text, re.S):
        out[int(m.group(1))] = m.group(2)
    return out


def tag_units(messages, schema):
    p = last_user(messages)
    topics = {int(i): n for i, n in re.findall(r"^(\d+): (.+?) \(", p, re.M)}
    chunks = excerpts(p.split("Chunks:\n", 1)[1])
    rows = []
    for k, text in chunks.items():
        best, score = -1, 0
        for i, name in topics.items():
            s = len(words(name) & words(text))
            if s > score:
                best, score = i, s
        rows.append({"i": k, "topic": best, "confidence": 0.9 if score else 0.3,
                     "subtopic": " ".join(text.split()[:3]).strip(".,:"),
                     "concepts": sorted(words(text))[:2], "prerequisites": []})
    return {"units": rows}


def propose_topics(messages, schema):
    """One new topic named after the first chunk, one subtopic per chunk."""
    p = last_user(messages)
    chunks = re.findall(r"^\[(\d+)\] \([^)]*\) (.+)$", p.split("Chunks:\n", 1)[1], re.M)
    if not chunks:
        return {"chapters": []}
    first = " ".join(chunks[0][1].split(":")[0].split()[:4])
    return {"chapters": [{"name": "Magnetic Effects of Current", "topics": [{
        "name": first, "summary": f"What {first.lower()} means and how it is used.",
        "subtopics": [{"name": f"Part {int(k) + 1}", "chunks": [int(k)]} for k, _ in chunks]}]}]}


def tutor_answer(messages, schema):
    p = last_user(messages)
    q = p.split("Question:", 1)[1]
    ex = excerpts(p.split("Excerpts:\n", 1)[1])
    best, score = None, 0
    for n, t in ex.items():
        s = len(words(q) & words(t))
        if s > score:
            best, score = n, s
    if best is None or score < 2:
        return {"covered": False, "answer": ""}
    body = ex[best].split("\n", 1)[-1]
    first = re.split(r"(?<=[.!?])\s+", body.strip())[0]
    return {"covered": True, "answer": f"{first} [{best}]"}


def generate_questions(messages, schema):
    p = last_user(messages)
    topic = re.search(r"Topic: (.+)", p).group(1)
    ex = excerpts(p.split("Excerpts:\n", 1)[1])
    qs = []
    for n, t in list(ex.items())[:3]:
        first = re.split(r"(?<=[.!?])\s+", t.split(") ", 1)[-1].strip())[0][:160]
        stem = f"According to your material on {topic}, which statement is correct? ({n}: {' '.join(sorted(words(t))[:3])})"
        qs.append({"type": "MCQ", "difficulty": ["Easy", "Medium", "Hard"][n % 3], "question": stem,
                   "options": [first, "Current is used up in a resistor", "Resistance never changes", "Voltage has no unit"],
                   "answer": first, "unit": "", "expression": "", "rubric": [], "explanation": first,
                   "misconceptions": [{"answer": "Current is used up in a resistor", "reason": "Thinks charge is consumed"}], "cite": n})
        _keys[stem] = first
    stem = f"A {topic.lower()} circuit: a heater draws 4 A from 220 V. What is its power? (set {len(_keys)})"
    qs.append({"type": "Numerical", "difficulty": "Medium", "question": stem, "options": [], "answer": "880", "unit": "W",
               "expression": "220*4", "rubric": [], "explanation": "P = VI = 880 W.",
               "misconceptions": [{"answer": "55", "reason": "Divides V by I"}], "cite": 1})
    _keys[stem] = "880"
    stem = f"Why are home appliances in {topic.lower()} lessons wired in parallel? (set {len(_keys)})"
    qs.append({"type": "Short answer", "difficulty": "Hard", "question": stem, "options": [], "answer": "",
               "unit": "", "expression": "", "rubric": ["each appliance gets the full voltage", "one failing does not affect others"],
               "explanation": "Parallel wiring.", "misconceptions": [], "cite": 1})
    _keys[stem] = "supported"
    return {"questions": qs}


def verify_question(messages, schema):
    p = last_user(messages)
    q = re.search(r"Question: (.+)", p).group(1).strip()
    key = _keys.get(q, "")
    if key == "supported":
        return {"answer": "", "value": "", "supported": True, "reason": "ok"}
    return {"answer": key, "value": key, "supported": True, "reason": "ok"}


def grade_short(messages, schema):
    p = last_user(messages)
    ans = p.split("Student answer:", 1)[1].lower()
    rub = re.findall(r"^\d+\. (.+)$", p, re.M)
    return {"hits": [bool(words(r) & words(ans)) and len(words(r) & words(ans)) >= 2 for r in rub], "feedback": ""}


def notes_sections(messages, schema):
    ex = excerpts(last_user(messages).split("Excerpts:\n", 1)[1])
    secs = []
    for n, t in ex.items():
        body = t.split(") ", 1)[-1]
        secs.append({"heading": " ".join(body.split()[:4]), "text": body[:240], "term": "Ohm's law" if "Ohm" in body else "",
                     "definition": "V = IR" if "Ohm" in body else "", "example": "", "cite": n})
    return {"title": "Electricity notes", "sections": secs}


def notes_extras(messages, schema):
    return {"short_notes": ["Current is the rate of flow of charge.", "V = IR."], "key_points": ["Ammeter in series."],
            "concepts": [{"name": "Current", "meaning": "Flow of charge", "icon": "bolt"},
                         {"name": "Resistance", "meaning": "Opposes current", "icon": "block"}],
            "formulas": [{"name": "Ohm's law", "formula": "V = I R", "unit": "V"}],
            "confusions": [{"confusion": "Resistance vs resistivity", "clarification": "Shape vs material"}],
            "map_center": "Electricity", "map_nodes": [{"label": "Current", "explanation": "Flow of charge"},
                                                         {"label": "Resistance", "explanation": "Opposition"}],
            "map_edges": [["Current", "Electricity"], ["Resistance", "Current"]],
            "revision_checklist": ["I can state Ohm's law"],
            "flashcards": [{"front": "Unit of current?", "back": "Ampere", "topic": "Current", "section": 0},
                           {"front": "Ohm's law?", "back": "V = IR", "topic": "Ohm's law", "section": 0}],
            "audio_script": "Today we revised electricity."}


def judge_video(messages, schema):
    """Relevant when the video title shares a real word with the topic; off-topic otherwise."""
    u = last_user(messages)
    topic = u.split("Topic to learn:", 1)[1].split("\n", 1)[0]
    title = u.split("Video title:", 1)[1].split("\n", 1)[0]
    shared = {w for w in words(topic) if len(w) > 4} & words(title)
    return {"relevant": bool(shared), "score": 0.9 if shared else 0.1, "difficulty": "Beginner",
            "language": "Hindi" if "hindi" in title.lower() else "English", "reason": "Explains the topic step by step"}


def classify_query(messages, schema):
    q = last_user(messages).split("Search:", 1)[1].strip()
    return {"academic": not any(w in q.lower() for w in ("cricket", "movie", "song")), "topic": q}


def eval_draft_case(messages, schema):
    """A question about the excerpt's first few content words, answered by its first sentence."""
    text = last_user(messages).split(":\n", 1)[1].strip()
    first = re.split(r"(?<=[.!?])\s+", text)[0][:200]
    return {"question": f"What does the material say about {' '.join(sorted(words(text))[:3])}?", "answer": first}


def install() -> None:
    llm.clear_fakes()
    llm.register_fake("tag_units", tag_units)
    llm.register_fake("caption_figure", lambda m, s: {"kind": "diagram", "caption": "A circuit diagram with a battery and resistors.",
                                                      "labels": ["Battery", "R1", "R2"]})
    llm.register_fake("rewrite_query", lambda m, s: {"query": last_user(m).split("Latest message:", 1)[-1].strip()})
    llm.register_fake("tutor_answer", tutor_answer)
    llm.register_fake("grounding_check", lambda m, s: {"sentences": [{"i": i, "supported": True} for i in range(10)]})
    llm.register_fake("tutor_general", lambda m, s: "This is a general explanation that is outside your material.")
    llm.register_fake("generate_questions", generate_questions)
    llm.register_fake("verify_question", verify_question)
    llm.register_fake("grade_short", grade_short)
    llm.register_fake("notes_sections", notes_sections)
    llm.register_fake("notes_extras", notes_extras)
    llm.register_fake("classify_resource", lambda m, s: {"topics": [int(re.search(r"^(\d+):", last_user(m).split("Candidate topics:\n")[1], re.M).group(1))],
                                                         "difficulty": "Beginner", "languages": ["English"], "confidence": 0.8, "reason": "match"})
    llm.register_fake("eval_relevancy", lambda m, s: {"score": 0.9})
    llm.register_fake("eval_context_precision", lambda m, s: {"relevant": [True, False, True]})
    llm.register_fake("eval_context_recall", lambda m, s: {"statements": [{"text": "x", "supported": True}]})
    llm.register_fake("propose_topics", propose_topics)
    llm.register_fake("judge_video", judge_video)
    llm.register_fake("classify_query", classify_query)
    llm.register_fake("eval_draft_case", eval_draft_case)
    llm.register_fake("chat_evidence", lambda m, s: {"evidence": [{"topic": 0, "understood": 1}]})
