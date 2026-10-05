import logging
import re

from app.models import Question
from app.services import llm
from app.services.llm import LLMError, arr, obj
from app.services.questions import close, num

log = logging.getLogger(__name__)

SHORT_SCHEMA = obj({"hits": arr(llm.B), "feedback": llm.S})
STOP = set("a an the of to in on and or is are be it its as for with by that this at from each any not".split())


def _keyword_hit(point: str, answer: str) -> bool:
    words = [w for w in re.findall(r"[a-z0-9]+", point.lower()) if w not in STOP and len(w) > 2]
    if not words:
        return False
    a = answer.lower()
    return sum(1 for w in words if w[:5] in a) / len(words) >= 0.5


def grade(q: Question, response: str) -> dict:
    """Returns {grade: correct|partial|wrong, credit, rubric_hits, misconception}."""
    response = (response or "").strip()
    if q.qtype == "MCQ":
        ok = response == q.answer
        mis = "" if ok else q.misconceptions.get(response, "")
        return {"grade": "correct" if ok else "wrong", "credit": 1.0 if ok else 0.0, "rubric_hits": [], "misconception": mis}

    if q.qtype == "Numerical":
        v = num(response)
        ans = q.answer_num if q.answer_num is not None else num(q.answer)
        ok = v is not None and ans is not None and close(v, ans, q.tolerance or 0.01)
        mis = ""
        if not ok and v is not None:
            for k, reason in (q.misconceptions or {}).items():
                kv = num(k)
                if kv is not None and close(v, kv, 0.01):
                    mis = reason
                    break
        return {"grade": "correct" if ok else "wrong", "credit": 1.0 if ok else 0.0, "rubric_hits": [], "misconception": mis}

    rubric = list(q.rubric or [])
    if not rubric:
        return {"grade": "wrong", "credit": 0.0, "rubric_hits": [], "misconception": ""}
    hits: list[bool]
    try:
        out = llm.chat(
            [{"role": "system", "content": "You grade a school student's short answer against rubric points. A point "
                                           "is met if the answer states it in any words or language (English, Hindi, "
                                           "Hinglish). Be fair, not pedantic."},
             {"role": "user", "content": f"Question: {q.stem}\nRubric points:\n" +
                                         "\n".join(f"{i}. {p}" for i, p in enumerate(rubric)) +
                                         f"\n\nStudent answer: {response}\n\nReturn hits: one true/false per rubric point, in order."}],
            task="grade_short", schema=SHORT_SCHEMA, temperature=0.0,
        )
        hits = [bool(x) for x in (out.get("hits") or [])][: len(rubric)]
        hits += [False] * (len(rubric) - len(hits))
    except LLMError as e:
        log.warning("Short-answer grading fell back to keywords: %s", e)
        hits = [_keyword_hit(p, response) for p in rubric]
    n = sum(hits)
    g = "correct" if n == len(rubric) else "partial" if n else "wrong"
    return {"grade": g, "credit": n / len(rubric), "rubric_hits": hits, "misconception": ""}
