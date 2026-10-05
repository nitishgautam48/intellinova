"""Source-grounded Q&A (architecture v4, page 3): retrieval -> cited answer ->
faithfulness check -> cited answer, or decline / flag as outside the material."""
import logging
import re
import uuid

from sqlalchemy.orm import Session

from app.config import settings
from app.models import Message, User
from app.services import llm, retrieval
from app.services.llm import LLMError, arr, obj

log = logging.getLogger(__name__)

LANG_NOTE = {
    "en": "Answer in clear, simple English suitable for a school student.",
    "hing": "Answer in Hinglish: Hindi written in Roman (English) letters, mixed naturally with English "
            "technical terms, the way Indian students talk.",
    "hi": "Answer in Hindi using Devanagari script. Keep standard scientific symbols and formulas as they are.",
}

ANSWER_SCHEMA = obj({"covered": llm.B, "answer": llm.S})
CHECK_SCHEMA = obj({"sentences": arr(obj({"i": llm.INT, "supported": llm.B}))})
REWRITE_SCHEMA = obj({"query": llm.S})


def _history_text(history: list[Message], limit: int = 6) -> str:
    rows = history[-limit:]
    return "\n".join(f"{'Student' if m.role == 'user' else 'Tutor'}: {m.content[:600]}" for m in rows)


def standalone_query(question: str, history: list[Message]) -> str:
    if not history:
        return question
    try:
        out = llm.chat(
            [{"role": "system", "content": "Rewrite the student's latest message as one standalone search query "
                                           "for their study material. Keep the student's language."},
             {"role": "user", "content": f"Conversation:\n{_history_text(history)}\n\nLatest message: {question}"}],
            task="rewrite_query", schema=REWRITE_SCHEMA, temperature=0.0,
        )
        q = (out or {}).get("query", "").strip()
        return q or question
    except LLMError:
        return question


def split_sentences(text: str) -> list[str]:
    parts = re.split(r"(?<=[.!?।])\s+", text.strip())
    return [p for p in parts if len(p.strip()) > 2]


def check_grounding(answer: str, cites: dict[int, str]) -> float:
    """Share of sentences supported by the excerpts they cite (faithfulness pass)."""
    sents = split_sentences(answer)
    if not sents:
        return 0.0
    excerpts = "\n".join(f"[{n}] {t}" for n, t in cites.items())
    listed = "\n".join(f"{i}: {s}" for i, s in enumerate(sents))
    try:
        out = llm.chat(
            [{"role": "system", "content": (
                "You check a tutor's answer against source excerpts. A sentence is supported if the excerpts state "
                "or directly imply it (paraphrase and translation are fine). Linking or transition sentences with "
                "no factual claim count as supported. Anything that adds facts not in the excerpts is unsupported.")},
             {"role": "user", "content": f"Excerpts:\n{excerpts}\n\nAnswer sentences:\n{listed}\n\n"
                                         "Return JSON {\"sentences\": [{\"i\": n, \"supported\": true|false}]}"}],
            task="grounding_check", schema=CHECK_SCHEMA, model=settings.verifier_model, temperature=0.0,
        )
        rows = {r["i"]: bool(r.get("supported")) for r in out.get("sentences", []) if isinstance(r, dict) and "i" in r}
    except LLMError as e:
        log.warning("Grounding check unavailable: %s", e)
        # Without a checker, only accept sentences that carry a citation marker.
        rows = {i: bool(re.search(r"\[\d+\]", s)) for i, s in enumerate(sents)}
    return sum(1 for i in range(len(sents)) if rows.get(i, False)) / len(sents)


def answer(
    db: Session,
    user: User | None,
    question: str,
    history: list[Message],
    lang: str = "en",
    source_only: bool = False,
    subject_id: uuid.UUID | None = None,
    source_ids: list[uuid.UUID] | None = None,
) -> dict:
    """Returns {content, citations, status: answered|declined|outside, support}."""
    lang = lang if lang in LANG_NOTE else "en"
    query = standalone_query(question, history)
    hits = retrieval.search(db, query, user, subject_id=subject_id, source_ids=source_ids)

    if hits:
        numbered = {i + 1: h for i, h in enumerate(hits)}
        ctx = "\n\n".join(
            f"[{n}] ({h.source.title} · {h.unit.location}, {h.unit.kind})\n{h.unit.text[:1400]}"
            for n, h in numbered.items()
        )
        try:
            out = llm.chat(
                [
                    {"role": "system", "content": (
                        "You are IntelliNova, a patient tutor for Indian school students. Answer ONLY from the "
                        "numbered excerpts of the student's class material. Put the excerpt number in square "
                        "brackets right after every sentence that uses it, like [2]. Explain simply, step by step "
                        "when useful, in at most 6 sentences. If the excerpts do not contain the answer, set "
                        "covered to false and leave answer empty. " + LANG_NOTE[lang])},
                    *([{"role": "user", "content": "Earlier conversation:\n" + _history_text(history)}] if history else []),
                    {"role": "user", "content": f"Excerpts:\n{ctx}\n\nQuestion: {question}"},
                ],
                task="tutor_answer", schema=ANSWER_SCHEMA, temperature=0.2,
            )
        except LLMError as e:
            raise LLMError(f"The tutor is unavailable right now: {e}") from e
        text = (out or {}).get("answer", "").strip()
        used = sorted({int(n) for n in re.findall(r"\[(\d+)\]", text) if int(n) in numbered})
        if out.get("covered") and text and used:
            support = check_grounding(text, {n: numbered[n].unit.text[:1400] for n in used})
            if support >= settings.grounding_min_support:
                # Renumber citations 1..k in order of first use.
                order = []
                for n in re.findall(r"\[(\d+)\]", text):
                    n = int(n)
                    if n in numbered and n not in order:
                        order.append(n)
                remap = {old: new for new, old in enumerate(order, start=1)}
                text = re.sub(r"\[(\d+)\]", lambda m: f"[{remap[int(m.group(1))]}]" if int(m.group(1)) in remap else "", text)
                cites = [retrieval.citation(remap[o], numbered[o]) for o in order]
                return {"content": text, "citations": cites, "status": "answered", "support": round(support, 3)}
            log.info("Answer failed grounding (support %.2f); treating as not covered", support)

    if source_only:
        msg = {
            "en": "Your class material doesn't cover this, so I won't guess. Try asking about a topic from your "
                  "chapters, or turn off “Only my material” to get a general explanation marked as outside your notes.",
            "hing": "Aapke class material mein iske baare mein kuch nahi hai, isliye main guess nahi karunga. Apne "
                    "chapters ke kisi topic ke baare mein poochiye, ya “Only my material” band karke general "
                    "explanation lijiye.",
            "hi": "आपकी कक्षा की सामग्री में इसके बारे में जानकारी नहीं है, इसलिए मैं अनुमान नहीं लगाऊँगा। अपने अध्यायों "
                  "के किसी विषय के बारे में पूछिए, या “Only my material” बंद करके सामान्य व्याख्या लीजिए।",
        }[lang]
        return {"content": msg, "citations": [], "status": "declined", "support": None}

    try:
        general = llm.chat(
            [
                {"role": "system", "content": (
                    "You are IntelliNova, a tutor for Indian school students. The student's class material does not "
                    "cover this question. Give a short, careful general explanation (max 5 sentences). If you are "
                    "not sure of a fact, say so. " + LANG_NOTE[lang])},
                *([{"role": "user", "content": "Earlier conversation:\n" + _history_text(history)}] if history else []),
                {"role": "user", "content": question},
            ],
            task="tutor_general", temperature=0.3,
        )
    except LLMError as e:
        raise LLMError(f"The tutor is unavailable right now: {e}") from e
    return {"content": general, "citations": [], "status": "outside", "support": None}
