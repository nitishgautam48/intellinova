"""Adaptive assessment, question side (architecture v4, page 3):
generate from source-linked chunks -> verify (second model + sympy for
numericals) -> de-duplicate against the bank with pgvector -> serve."""
import logging
import re
import uuid

import sympy
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.config import settings
from app.models import ContentUnit, KbSource, Question, Topic
from app.services import embeddings, llm, retrieval
from app.services.llm import LLMError, arr, obj

log = logging.getLogger(__name__)

TYPES = ("MCQ", "Numerical", "Short answer")
DIFFS = ("Easy", "Medium", "Hard")


class NoMaterial(Exception):
    pass


GEN_SCHEMA = obj({
    "questions": arr(obj({
        "type": llm.S,
        "difficulty": llm.S,
        "question": llm.S,
        "options": arr(llm.S),
        "answer": llm.S,
        "unit": llm.S,
        "expression": llm.S,
        "rubric": arr(llm.S),
        "explanation": llm.S,
        "misconceptions": arr(obj({"answer": llm.S, "reason": llm.S})),
        "cite": llm.INT,
    }, ["type", "difficulty", "question", "answer", "explanation", "cite"]))
})

VERIFY_SCHEMA = obj({"answer": llm.S, "value": llm.S, "supported": llm.B, "reason": llm.S})


def topic_units(db: Session, topic: Topic, limit: int = 12) -> list[ContentUnit]:
    q = (
        select(ContentUnit)
        .join(KbSource, ContentUnit.source_id == KbSource.id)
        .where(KbSource.origin == "admin", KbSource.status.in_(retrieval.READY), ContentUnit.topic_id == topic.id)
        .order_by(ContentUnit.confidence.desc())
        .limit(limit)
    )
    units = list(db.scalars(q).all())
    if len(units) < 3:
        extra = retrieval.search(db, f"{topic.name}. {topic.summary}", None, k=8)
        seen = {u.id for u in units}
        units += [h.unit for h in extra if h.unit.id not in seen and h.source.origin == "admin"]
    return units[:limit]


def num(s: str | float | int | None) -> float | None:
    if s is None:
        return None
    if isinstance(s, (int, float)):
        return float(s)
    t = str(s).replace(",", "").replace("−", "-")
    t = re.sub(r"10([⁻⁰¹²³⁴⁵⁶⁷⁸⁹]+)", lambda m: "10^" + m.group(1).translate(SUPERSCRIPTS), t)
    # "8.8 × 10^2", "8.8x10^2", "8.8 * 10**2", "3.6 × 10⁶" -> scientific notation
    t = re.sub(r"\s*[×xX*]\s*10\s*(?:\^|\*\*)\s*([-+]?\d+)", r"e\1", t)
    m = re.search(r"-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?", t)
    return float(m.group(0)) if m else None


SUPERSCRIPTS = str.maketrans("⁰¹²³⁴⁵⁶⁷⁸⁹⁻", "0123456789-")


def eval_expression(expr: str) -> float | None:
    if not expr or len(expr) > 200:
        return None
    clean = expr.replace("^", "**").replace("×", "*").replace("÷", "/").replace("−", "-")
    if re.search(r"[^0-9eE+\-*/().\s*]", clean.replace("sqrt", "").replace("pi", "")):
        return None
    try:
        v = sympy.sympify(clean, locals={"sqrt": sympy.sqrt, "pi": sympy.pi})
        return float(v.evalf())
    except (sympy.SympifyError, TypeError, ValueError, ZeroDivisionError):
        return None


def close(a: float, b: float, tol: float = 0.01) -> bool:
    return abs(a - b) <= max(abs(b) * tol, 1e-9)


def _verify(q: dict, excerpt: str) -> tuple[str, dict]:
    """Returns (status, verification details)."""
    qtype = q["type"]
    details: dict = {}
    if qtype == "MCQ":
        opts = [o.strip() for o in q.get("options") or [] if isinstance(o, str) and o.strip()]
        if len(opts) != 4 or len(set(o.lower() for o in opts)) != 4 or q["answer"].strip() not in opts:
            return "rejected", {"reason": "MCQ needs 4 distinct options including the answer"}
    if qtype == "Numerical":
        ans = num(q["answer"])
        if ans is None:
            return "rejected", {"reason": "Numerical answer is not a number"}
        solved = eval_expression(q.get("expression", ""))
        details["sympy"] = solved
        if solved is None or not close(solved, ans):
            return "disagreement", {**details, "reason": "Solver result does not match the key"}
    if qtype == "Short answer" and len([r for r in q.get("rubric") or [] if str(r).strip()]) < 1:
        return "rejected", {"reason": "Short answer needs rubric points"}

    prompt = f"Source excerpt:\n{excerpt[:1500]}\n\nQuestion: {q['question']}\n"
    if qtype == "MCQ":
        prompt += "Options:\n" + "\n".join(q["options"]) + "\nReply with the exact text of the correct option as answer."
    elif qtype == "Numerical":
        prompt += "Solve it. Put only the final number (no units) in value."
    else:
        prompt += "Key points expected in a full-credit answer:\n- " + "\n- ".join(q["rubric"]) + \
                  "\nSet supported=true only if these points are correct and backed by the excerpt."
    try:
        out = llm.chat([{"role": "system", "content": "You independently check quiz questions for a school exam "
                                                        "board. Be strict and use the excerpt as ground truth."},
                        {"role": "user", "content": prompt}],
                       task="verify_question", schema=VERIFY_SCHEMA, model=settings.verifier_model, temperature=0.0)
    except LLMError as e:
        return "disagreement", {**details, "reason": f"Second model unavailable: {e}"}
    details["second_model"] = out
    if qtype == "MCQ":
        ok = (out.get("answer") or "").strip().lower() == q["answer"].strip().lower()
    elif qtype == "Numerical":
        v = num(out.get("value") or out.get("answer"))
        ok = v is not None and close(v, num(q["answer"]))
    else:
        ok = bool(out.get("supported"))
    if not ok:
        return "disagreement", {**details, "reason": "Second model disagreed with the answer key"}
    return "verified", details


def generate(db: Session, topic: Topic, n: int, types: list[str] | None = None,
             difficulties: list[str] | None = None) -> dict:
    """Generates up to n new verified questions for a topic. Returns counts by status."""
    types = [t for t in (types or list(TYPES)) if t in TYPES] or list(TYPES)
    difficulties = [d for d in (difficulties or list(DIFFS)) if d in DIFFS] or list(DIFFS)
    units = topic_units(db, topic)
    if not units:
        raise NoMaterial(f"No class material is linked to “{topic.name}” yet.")
    numbered = {i + 1: u for i, u in enumerate(units)}
    ctx = "\n\n".join(f"[{i}] ({u.location}) {u.text[:900]}" for i, u in numbered.items())
    existing = [q for (q,) in db.execute(select(Question.stem).where(Question.topic_id == topic.id).limit(40))]
    ask = max(n + 2, 4)
    try:
        out = llm.chat(
            [
                {"role": "system", "content": (
                    "You write exam-style questions for Indian school students, strictly from the numbered excerpts. "
                    "Rules: every question must be answerable from one excerpt (give its number in cite). "
                    "MCQ: exactly 4 options, answer is the exact text of the correct option, and misconceptions maps "
                    "each wrong option to the mistake it reveals. Numerical: answer is a number; unit is the SI unit; "
                    "expression is the arithmetic that produces the answer (e.g. 220*4); misconceptions maps likely "
                    "wrong numbers to the mistake. Short answer: rubric lists 2-3 key points for full credit. "
                    "explanation is 1-2 sentences using the source. Difficulty is Easy, Medium or Hard.")},
                {"role": "user", "content": (
                    f"Topic: {topic.name}\nWrite {ask} questions. Allowed types: {', '.join(types)}. "
                    f"Difficulties to cover: {', '.join(difficulties)}.\n"
                    + ("Avoid repeating these existing questions:\n- " + "\n- ".join(existing[:20]) + "\n" if existing else "")
                    + f"\nExcerpts:\n{ctx}")},
            ],
            task="generate_questions", schema=GEN_SCHEMA, temperature=0.5,
        )
    except LLMError as e:
        raise LLMError(f"Question generation failed: {e}") from e

    counts = {"generated": 0, "verified": 0, "disagreement": 0, "rejected": 0, "duplicate": 0}
    bank = list(db.execute(select(Question.id, Question.embedding).where(Question.topic_id == topic.id,
                                                                         Question.embedding.is_not(None))).all())
    new_vecs: list[list[float]] = []
    for raw in (out or {}).get("questions", []):
        if not isinstance(raw, dict) or not raw.get("question") or raw.get("type") not in types:
            continue
        counts["generated"] += 1
        raw["answer"] = str(raw.get("answer", "")).strip()
        if raw.get("difficulty") not in DIFFS:
            raw["difficulty"] = "Medium"
        unit = numbered.get(raw.get("cite")) or units[0]
        vec = embeddings.embed_one(raw["question"], "passage")
        dup = any(embeddings.cosine(vec, list(e)) >= settings.dedup_threshold for _, e in bank) or any(
            embeddings.cosine(vec, v) >= settings.dedup_threshold for v in new_vecs)
        if dup:
            counts["duplicate"] += 1
            db.add(Question(topic_id=topic.id, qtype=raw["type"], difficulty=raw["difficulty"], stem=raw["question"],
                            status="duplicate", unit_id=unit.id))
            continue
        status, details = _verify(raw, unit.text)
        counts[status] += 1
        mis: dict[str, str] = {}
        for m in raw.get("misconceptions") or []:
            if isinstance(m, dict) and m.get("answer") and m.get("reason"):
                key = str(m["answer"]).strip()
                if raw["type"] == "Numerical" and num(key) is not None:
                    key = repr(num(key))
                mis[key] = str(m["reason"]).strip()
        q = Question(
            topic_id=topic.id, qtype=raw["type"], difficulty=raw["difficulty"], stem=raw["question"].strip(),
            options=[o.strip() for o in raw.get("options") or []] if raw["type"] == "MCQ" else [],
            answer=raw["answer"], answer_num=num(raw["answer"]) if raw["type"] == "Numerical" else None,
            unit=(raw.get("unit") or "").strip()[:20] if raw["type"] == "Numerical" else "",
            rubric=[str(r).strip() for r in raw.get("rubric") or [] if str(r).strip()] if raw["type"] == "Short answer" else [],
            explanation=(raw.get("explanation") or "").strip(), misconceptions=mis, unit_id=unit.id,
            status=status, verification=details, embedding=vec,
            irt_b={"Easy": -1.0, "Medium": 0.0, "Hard": 1.0}[raw["difficulty"]],
        )
        db.add(q)
        new_vecs.append(vec)
        if counts["verified"] >= n:
            break
    db.commit()
    return counts


def bank_stats(db: Session) -> dict:
    rows = dict(db.execute(select(Question.status, func.count()).group_by(Question.status)).all())
    total = sum(rows.values())
    return {
        "generated": total,
        "verified": rows.get("verified", 0),
        "disagreement": rows.get("disagreement", 0),
        "rejected": rows.get("rejected", 0),
        "duplicate": rows.get("duplicate", 0),
    }


def pool(db: Session, topic_ids: list[uuid.UUID], types: list[str]) -> int:
    return db.scalar(select(func.count()).select_from(Question).where(
        Question.topic_id.in_(topic_ids), Question.status == "verified", Question.qtype.in_(types))) or 0
