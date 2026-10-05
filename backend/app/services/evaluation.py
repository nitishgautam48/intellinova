"""Offline evaluation harness (architecture v4, page 4).

Runs the real RAG pipeline over a held-out test set written by the content
team and scores it with RAGAS-style metrics (faithfulness, answer relevancy,
context precision, context recall) plus two IntelliNova-specific ones:
off-material handling and citation accuracy. The local LLM is the judge.
If the `ragas` package is installed and RAGAS is selected, its implementations
are used for the four core metrics; the run records which engine produced
the numbers. DeepEval and TruLens are used the same way when installed.

Then simulated students are driven through the real quiz engine (question picking, grading, BKT/FSRS
updates, repeat avoidance) inside a transaction that is rolled back, so nothing they do is kept.
"""
import logging
import math
import os
import random
import re
import time
import uuid
from datetime import datetime, timedelta, timezone
from statistics import mean

from sqlalchemy import event, func, select
from sqlalchemy.orm import Session

from app.config import settings
from app.models import AppSetting, EvalCase, EvalRun, Question
from app.services import grounding, learner, llm, questions, retrieval
from app.services.llm import LLMError, arr, obj

log = logging.getLogger(__name__)

# Everything stays on this machine: the evaluation libraries' usage telemetry is switched off.
for _k, _v in (("RAGAS_DO_NOT_TRACK", "true"), ("DEEPEVAL_TELEMETRY_OPT_OUT", "YES"), ("DEEPEVAL_GRPC_LOGGING", "NO"),
               ("LITELLM_TELEMETRY", "False"), ("TRULENS_OTEL_TRACING", "0"), ("ANONYMIZED_TELEMETRY", "False")):
    os.environ.setdefault(_k, _v)

TARGETS = {"faith": 0.85, "relev": 0.85, "cprec": 0.80, "crec": 0.80, "refuse": 0.90, "cite": 0.85}
LABELS = {"faith": "Faithfulness", "relev": "Answer relevancy", "cprec": "Context precision",
          "crec": "Context recall", "refuse": "Off-material handled", "cite": "Citation accuracy"}

REL_SCHEMA = obj({"score": llm.N})
CTX_SCHEMA = obj({"relevant": arr(llm.B)})
REC_SCHEMA = obj({"statements": arr(obj({"text": llm.S, "supported": llm.B}))})


def pipeline_version(db: Session) -> str:
    s = db.get(AppSetting, "pipeline_version")
    if s and s.value.get("v"):
        return s.value["v"]
    return f"{settings.llm_model} · {settings.embeddings_model.split('/')[-1]} · k={settings.retrieval_k}"


def _norm_loc(s: str) -> str:
    """"Page 2", "pg. 2", "p 2" and "p. 2" all become "p2"; other punctuation and spaces are dropped."""
    s = re.sub(r"\b(?:pages?|pgs?|pp?)\b\.?", "p", s.lower())
    return re.sub(r"[^a-z0-9:.]", "", s)


def _loc_match(a: str, b: str) -> bool:
    """Same place, allowing one side to be more specific ("p. 2" matches "p. 2 · Fig. 11.1"), but not a different
    number that merely starts the same way ("p. 1" must not match "p. 12")."""
    if not a or not b:
        return False
    short, long_ = sorted((a, b), key=len)
    return long_.startswith(short) and (len(long_) == len(short) or not (short[-1].isdigit() and long_[len(short)].isdigit()))


def _judge_relevancy(q: str, a: str) -> float:
    out = llm.chat([{"role": "system", "content": "Rate 0 to 1 how directly and completely the answer addresses the "
                                                   "question (ignore whether it is correct)."},
                    {"role": "user", "content": f"Question: {q}\nAnswer: {a}"}],
                   task="eval_relevancy", schema=REL_SCHEMA, model=settings.verifier_model, temperature=0.0)
    return max(0.0, min(1.0, float(out.get("score", 0))))


def _judge_context_precision(q: str, ref: str, ctxs: list[str]) -> float:
    if not ctxs:
        return 0.0
    listed = "\n".join(f"{i}: {c[:700]}" for i, c in enumerate(ctxs))
    out = llm.chat([{"role": "system", "content": "For each retrieved passage, say whether it is useful for answering "
                                                   "the question, given the reference answer."},
                    {"role": "user", "content": f"Question: {q}\nReference answer: {ref}\nPassages:\n{listed}"}],
                   task="eval_context_precision", schema=CTX_SCHEMA, model=settings.verifier_model, temperature=0.0)
    rel = [bool(x) for x in out.get("relevant", [])][: len(ctxs)]
    rel += [False] * (len(ctxs) - len(rel))
    # RAGAS context precision: mean precision@k over relevant positions.
    hits, total = 0, 0.0
    for k, r in enumerate(rel, start=1):
        if r:
            hits += 1
            total += hits / k
    return total / hits if hits else 0.0


def _judge_context_recall(ref: str, ctxs: list[str]) -> float:
    if not ref.strip():
        return 1.0
    out = llm.chat([{"role": "system", "content": "Split the reference answer into short factual statements and say "
                                                   "whether each is supported by the passages."},
                    {"role": "user", "content": f"Reference answer: {ref}\nPassages:\n" + "\n".join(c[:700] for c in ctxs)}],
                   task="eval_context_recall", schema=REC_SCHEMA, model=settings.verifier_model, temperature=0.0)
    st = [s for s in out.get("statements", []) if isinstance(s, dict)]
    return sum(1 for s in st if s.get("supported")) / len(st) if st else 0.0


def _num(x) -> float | None:
    """A metric value, or None when the framework produced NaN / nothing for this row."""
    try:
        v = float(x)
    except (TypeError, ValueError):
        return None
    return None if math.isnan(v) else max(0.0, min(1.0, v))


class _LocalEmbeddings:
    """LangChain-style embeddings backed by IntelliNova's own multilingual model (no Ollama model needed)."""

    def embed_documents(self, texts: list[str]) -> list[list[float]]:
        from app.services import embeddings

        return embeddings.embed(list(texts), "passage")

    def embed_query(self, text: str) -> list[float]:
        from app.services import embeddings

        return embeddings.embed_one(text, "query")

    async def aembed_documents(self, texts: list[str]) -> list[list[float]]:
        return self.embed_documents(texts)

    async def aembed_query(self, text: str) -> list[float]:
        return self.embed_query(text)


def _ragas_scores(rows: list[dict]) -> list[dict] | None:
    """The official RAGAS metrics (faithfulness, answer relevancy, context precision with reference, context
    recall), judged by the local verifier model through Ollama and embedded with our own model."""
    try:
        from langchain_core.embeddings import Embeddings
        from langchain_ollama import ChatOllama
        from ragas import EvaluationDataset, SingleTurnSample, evaluate
        from ragas.embeddings import LangchainEmbeddingsWrapper
        from ragas.llms import LangchainLLMWrapper
        from ragas.metrics import Faithfulness, LLMContextPrecisionWithReference, LLMContextRecall, ResponseRelevancy
        from ragas.run_config import RunConfig
    except ImportError:
        return None
    try:
        emb_cls = type("LocalEmbeddings", (_LocalEmbeddings, Embeddings), {})
        ds = EvaluationDataset(samples=[SingleTurnSample(
            user_input=r["q"], response=r["a"] or "(no answer)", retrieved_contexts=r["ctx"] or [""],
            reference=r["ref"] or "") for r in rows])
        judge = LangchainLLMWrapper(ChatOllama(model=settings.verifier_model, base_url=settings.ollama_url,
                                               temperature=0, num_ctx=settings.llm_num_ctx))
        res = evaluate(ds, metrics=[Faithfulness(), ResponseRelevancy(), LLMContextPrecisionWithReference(), LLMContextRecall()],
                       llm=judge, embeddings=LangchainEmbeddingsWrapper(emb_cls()), show_progress=False,
                       run_config=RunConfig(timeout=int(settings.llm_timeout_s), max_workers=2, max_retries=2))
        df = res.to_pandas()
        out = [{"faith": _num(x.get("faithfulness")), "relev": _num(x.get("answer_relevancy")),
                "cprec": _num(x.get("llm_context_precision_with_reference")), "crec": _num(x.get("context_recall"))}
               for _, x in df.iterrows()]
        if not any(v is not None for row in out for v in row.values()):
            raise ValueError("RAGAS returned no scores (the judge model's answers could not be parsed)")
        return out
    except Exception as e:  # noqa: BLE001
        log.warning("ragas evaluation failed, using built-in judges: %s", e)
        return None


def _deepeval_scores(rows: list[dict]) -> list[dict] | None:
    """DeepEval's faithfulness / answer relevancy / contextual precision / contextual recall, judged by Ollama."""
    try:
        from deepeval.metrics import (
            AnswerRelevancyMetric,
            ContextualPrecisionMetric,
            ContextualRecallMetric,
            FaithfulnessMetric,
        )
        from deepeval.models import OllamaModel
        from deepeval.test_case import LLMTestCase
    except ImportError:
        return None
    try:
        judge = OllamaModel(model=settings.verifier_model, base_url=settings.ollama_url, temperature=0)
        out = []
        for r in rows:
            tc = LLMTestCase(input=r["q"], actual_output=r["a"] or "(no answer)", expected_output=r["ref"] or "",
                             retrieval_context=r["ctx"] or [""])
            vals = {}
            for key, cls in (("faith", FaithfulnessMetric), ("relev", AnswerRelevancyMetric),
                             ("cprec", ContextualPrecisionMetric), ("crec", ContextualRecallMetric)):
                try:
                    m = cls(model=judge, include_reason=False, async_mode=False)
                    m.measure(tc)
                    vals[key] = _num(m.score)
                except Exception as e:  # noqa: BLE001 - one metric failing shouldn't sink the row
                    log.warning("deepeval %s failed on %r: %s", key, r["q"][:60], e)
                    vals[key] = None
            out.append(vals)
        return out
    except Exception as e:  # noqa: BLE001
        log.warning("deepeval evaluation failed, using built-in judges: %s", e)
        return None


def _trulens_scores(rows: list[dict]) -> list[dict] | None:
    """TruLens feedback functions (groundedness, answer relevance, context relevance) via LiteLLM → Ollama.
    TruLens has no context-recall feedback, so that one stays on the built-in judge."""
    try:
        from trulens.providers.litellm import LiteLLM
    except ImportError:
        return None
    try:
        from trulens.core.metric.metric import GroundednessConfigs

        # Our own sentence split (no NLTK data download needed at run time).
        gcfg = GroundednessConfigs(use_sent_tokenize=False, filter_trivial_statements=False)
    except Exception:  # noqa: BLE001 - older TruLens
        gcfg = None
    try:
        prov = LiteLLM(model_engine=f"ollama/{settings.verifier_model}", completion_kwargs={"api_base": settings.ollama_url})
        out = []
        for r in rows:
            vals: dict[str, float | None] = {"faith": None, "relev": None, "cprec": None, "crec": None}
            try:
                src = "\n\n".join(r["ctx"]) or ""
                if r["a"]:
                    sents = "\n".join(x.strip() for x in re.split(r"(?<=[.!?।])\s+", re.sub(r"\[\d+\]", "", r["a"])) if x.strip())
                    g = (prov.groundedness_measure_with_cot_reasons(src, sents, groundedness_configs=gcfg) if gcfg
                         else prov.groundedness_measure_with_cot_reasons(src, sents))
                else:
                    g = (0.0, {})
                vals["faith"] = _num(g[0] if isinstance(g, tuple) else g)
                vals["relev"] = _num(prov.relevance(r["q"], r["a"])) if r["a"] else 0.0
                cr = [_num(prov.context_relevance(r["q"], c)) for c in r["ctx"]]
                cr = [x for x in cr if x is not None]
                vals["cprec"] = mean(cr) if cr else None
            except Exception as e:  # noqa: BLE001
                log.warning("trulens failed on %r: %s", r["q"][:60], e)
            out.append(vals)  # context recall: TruLens has none, the built-in judge fills it in
        if not any(v is not None for row in out for v in row.values()):
            raise ValueError("TruLens returned no scores")
        return out
    except Exception as e:  # noqa: BLE001
        log.warning("trulens evaluation failed, using built-in judges: %s", e)
        return None


FRAMEWORKS = {"RAGAS": ("ragas", _ragas_scores), "DeepEval": ("deepeval", _deepeval_scores), "TruLens": ("trulens", _trulens_scores)}
PACKAGES = {"RAGAS": "ragas", "DeepEval": "deepeval", "TruLens": "trulens"}


def framework_available(name: str) -> bool:
    import importlib.util

    pkg = PACKAGES.get(name)
    return bool(pkg and importlib.util.find_spec(pkg))


def run_rag_eval(db: Session, run: EvalRun) -> None:
    cases = list(db.scalars(select(EvalCase).order_by(EvalCase.created_at)))
    if not cases:
        raise ValueError("Add test questions to the evaluation set first.")
    rows = []
    for i, c in enumerate(cases):
        t0 = time.time()
        res = grounding.answer(db, None, c.question, [], "en", source_only=True, subject_id=c.subject_id)
        latency = time.time() - t0
        hits = retrieval.search(db, c.question, None, subject_id=c.subject_id)
        rows.append({"case": c, "q": c.question, "a": res["content"] if res["status"] == "answered" else "",
                     "status": res["status"], "support": res.get("support"), "cites": res["citations"],
                     "ctx": [h.unit.text for h in hits], "ref": c.expected_answer, "latency": latency,
                     "answer_text": res["content"]})
        run.progress = round(0.6 * (i + 1) / len(cases), 3)
        db.commit()

    engine, note = "builtin", ""
    in_mat = [r for r in rows if not r["case"].off_material]
    name, fn = FRAMEWORKS.get(run.framework, ("builtin", None))
    fw_rows = fn(in_mat) if fn and in_mat else None
    if fw_rows is not None:
        engine = name
        for r, sc in zip(in_mat, fw_rows):
            r.update(sc)
    else:
        note = (f"{run.framework} isn't installed on the server; " if fn and not framework_available(run.framework) else
                f"{run.framework} failed on this run (see the worker log); " if fn else "") + \
            "the same four metrics were scored by IntelliNova's built-in LLM judges."
    # Anything the framework couldn't score for a question (or everything, without a framework) is scored
    # by the built-in judges, so every question has all four numbers.
    builtin = {"faith": lambda r: r["support"] if r["support"] is not None else 0.0,
               "relev": lambda r: _judge_relevancy(r["q"], r["a"]) if r["a"] else 0.0,
               "cprec": lambda r: _judge_context_precision(r["q"], r["ref"], r["ctx"]),
               "crec": lambda r: _judge_context_recall(r["ref"], r["ctx"])}
    filled = 0
    for r in in_mat:
        for key, judge in builtin.items():
            if r.get(key) is None:
                try:
                    r[key] = judge(r)
                except LLMError as e:
                    raise ValueError(f"The judge model is unavailable: {e}") from e
                filled += engine != "builtin"
    if filled:
        note = f"{filled} of {4 * len(in_mat)} scores {run.framework} couldn't produce were filled in by the built-in judges."
    for r in in_mat:
        exp = [_norm_loc(x) for x in r["case"].expected_locations if x.strip()]
        got = [_norm_loc(c["location"]) for c in r["cites"]]
        r["cite"] = (1.0 if any(_loc_match(e, g) for e in exp for g in got) else 0.0) if exp else (1.0 if got else 0.0)
    off = [r for r in rows if r["case"].off_material]
    refuse = mean([1.0 if r["status"] == "declined" else 0.0 for r in off]) if off else None

    def avg(key, rs):
        vals = [r[key] for r in rs if r.get(key) is not None]
        return round(mean(vals), 3) if vals else None

    metrics = {k: avg(k, in_mat) for k in ("faith", "relev", "cprec", "crec", "cite")}
    metrics["refuse"] = round(refuse, 3) if refuse is not None else None
    lat = sorted(r["latency"] for r in rows)
    extra = {
        "answered": round(sum(1 for r in in_mat if r["status"] == "answered") / len(in_mat), 3) if in_mat else None,
        "latency_avg_s": round(mean(lat), 1) if lat else None,
        "latency_p90_s": round(lat[min(len(lat) - 1, int(0.9 * len(lat)))], 1) if lat else None,
        "models": {"answer": settings.llm_model, "judge": settings.verifier_model,
                   "embeddings": settings.embeddings_model, "rerank": settings.rerank_model or "off",
                   "k": settings.retrieval_k, "num_ctx": settings.llm_num_ctx},
    }
    per_case = [{
        "q": r["q"], "category": r["case"].category, "off": r["case"].off_material, "status": r["status"],
        "expected": list(r["case"].expected_locations), "cited": [c["location"] for c in r["cites"]],
        **{k: (round(r[k], 3) if r.get(k) is not None else None) for k in ("faith", "relev", "cprec", "crec", "cite")},
        "latency_s": round(r["latency"], 1), "answer": (r["answer_text"] or "")[:600], "reference": r["ref"][:600],
    } for r in rows]
    run.metrics = {"values": metrics, "targets": TARGETS, "engine": engine, "engine_note": note, "n_cases": len(cases),
                   "n_off": len(off), "n_off_handled": sum(1 for r in off if r["status"] == "declined"),
                   "extra": extra, "cases": per_case}
    cats = {}
    for r in in_mat:
        cats.setdefault(r["case"].category, []).append(r)
    run.categories = [{"l": k, "n": len(v), "faith": avg("faith", v), "relev": avg("relev", v),
                       "cprec": avg("cprec", v), "crec": avg("crec", v)} for k, v in sorted(cats.items())]
    fails = []
    for r in in_mat:
        worst = min(("faith", "crec", "cite"), key=lambda k: r.get(k) if r.get(k) is not None else 1)
        if (r.get(worst) or 0) < 0.6:
            what = {"faith": "Answer added claims not in the retrieved sources",
                    "crec": "Retrieved passages miss part of the reference answer",
                    "cite": f"Cited {', '.join(c['location'] for c in r['cites']) or 'nothing'}; expected "
                            f"{', '.join(r['case'].expected_locations) or 'a source location'}"}[worst]
            fails.append({"q": r["q"], "w": what, "m": LABELS[worst], "score": r.get(worst)})
    for r in off:
        if r["status"] != "declined":
            fails.append({"q": r["q"], "w": "Off-material question answered without a flag", "m": LABELS["refuse"], "score": 0})
    run.failures = sorted(fails, key=lambda f: f["score"] or 0)[:8]


# --------------------------------------------------------------------------- simulated students

PERSONAS = [
    ("Struggling with maths", -1.4, 0.10, 0.0),
    ("Strong, fast learner", 0.4, 0.22, 0.0),
    ("Hindi-first learner", -0.9, 0.14, 0.0),
    ("Irregular, skips days", -0.7, 0.14, 0.4),
    ("New student, no history", -1.1, 0.15, 0.0),
    ("Exam in two weeks", -0.3, 0.16, 0.0),
]


def _simulate(db: Session, adaptive: bool, theta0: float, lr: float, skip: float, sessions: int, rng: random.Random,
              bank: dict[str, list[float]]) -> tuple[list[float], float]:
    """One simulated student on one topic. Returns (estimated mastery per session, repetition rate)."""
    theta, p_est, served, repeats = theta0, learner.P_INIT, [], 0
    curve = [p_est]
    pools = {d: list(range(len(v))) for d, v in bank.items()}
    for _ in range(sessions):
        if rng.random() < skip:
            theta -= 0.05  # forgetting on skipped days
            curve.append(p_est)
            continue
        for _q in range(5):
            diff = learner.target_difficulty(p_est) if adaptive else rng.choice(("Easy", "Medium", "Hard"))
            b_list = bank.get(diff) or [0.0]
            pool = pools.get(diff) or []
            if pool:
                idx = pool.pop(rng.randrange(len(pool)))
            else:
                idx = rng.randrange(len(b_list))
                repeats += 1
            b = b_list[idx]
            served.append((diff, idx))
            p_correct = 1 / (1 + math.exp(-(theta - b)))
            correct = rng.random() < p_correct
            p_est = learner.bkt_update(p_est, 1.0 if correct else 0.0, learner.P_SLIP,
                                       learner.GUESS["MCQ"], learner.P_TRANSIT)
            # Learning is fastest on items near the student's level (zone of proximal development).
            theta += lr * math.exp(-((theta - b) ** 2) / 1.5) * (1.0 if correct else 0.6)
        curve.append(p_est)
    return curve, repeats / max(len(served), 1)


def run_simulation(db: Session, sessions: int = 10) -> dict:
    rows = db.execute(select(Question.difficulty, Question.irt_b).where(Question.status == "verified")).all()
    bank: dict[str, list[float]] = {"Easy": [], "Medium": [], "Hard": []}
    for d, b in rows:
        bank.setdefault(d, []).append(b)
    synthetic = not any(bank.values())
    if synthetic:  # no bank yet: simulate against a nominal bank so the harness still runs
        bank = {"Easy": [-1.0] * 30, "Medium": [0.0] * 30, "Hard": [1.0] * 30}
    rng = random.Random(42)
    personas, all_ad, all_base = [], [], []
    for name, th, lr, skip in PERSONAS:
        ad_curves, base_curves, reps = [], [], []
        for _ in range(20):
            c1, r1 = _simulate(db, True, th + rng.gauss(0, 0.2), lr, skip, sessions, rng, bank)
            c2, _ = _simulate(db, False, th + rng.gauss(0, 0.2), lr, skip, sessions, rng, bank)
            ad_curves.append(c1)
            base_curves.append(c2)
            reps.append(r1)
        ad = [round(mean(c[i] for c in ad_curves), 3) for i in range(sessions + 1)]
        base = [round(mean(c[i] for c in base_curves), 3) for i in range(sessions + 1)]
        all_ad.append(ad)
        all_base.append(base)
        personas.append({"t": name, "a": ad[0], "b": ad[-1], "g": round(ad[-1] - ad[0], 3),
                         "r": f"{round(100 * mean(reps), 1)}%", "curve": ad})
    return {
        "sessions": sessions,
        "adaptive": [round(mean(c[i] for c in all_ad), 3) for i in range(sessions + 1)],
        "baseline": [round(mean(c[i] for c in all_base), 3) for i in range(sessions + 1)],
        "personas": personas,
        "synthetic_bank": synthetic,
        "bank_size": sum(len(v) for v in bank.values()),
    }


DIFF_B = {"Easy": -1.0, "Medium": 0.0, "Hard": 1.0}
SIM_TYPES = ["MCQ", "Numerical"]
MIN_BANK = 8


def _sim_response(q: Question, correct: bool, rng: random.Random) -> str:
    if q.qtype == "MCQ":
        if correct:
            return q.answer
        wrong = [o for o in q.options or [] if o != q.answer]
        return rng.choice(wrong) if wrong else "(no answer)"
    if correct:
        return str(q.answer_num if q.answer_num is not None else q.answer)
    return "-987654321"


def run_engine_simulation(db: Session, sessions: int = 8, students: int = 3, seed: int = 42) -> dict | None:
    """Simulated students take real quizzes: the live quiz engine picks every question (adaptive difficulty from
    their BKT mastery, repeat avoidance), grades their answers and updates BKT/FSRS. Each student has a hidden
    ability (IRT) and learns most from items near their level. The baseline takes the same quizzes at a fixed
    difficulty. Everything runs on a separate connection inside a transaction that is rolled back.

    Returns None when no topic has enough verified auto-gradable questions yet."""
    from app.db import engine as db_engine
    from app.models import Mastery, Quiz, User
    from app.services import quiz_engine

    counts = db.execute(select(Question.topic_id, func.count()).where(Question.status == "verified", Question.qtype.in_(SIM_TYPES))
                        .group_by(Question.topic_id).having(func.count() >= MIN_BANK).order_by(func.count().desc()).limit(3)).all()
    if not counts:
        return None
    topics = [t for t, _ in counts]
    # A question's true difficulty: its calibrated IRT b (seeded from Easy/Medium/Hard at generation and
    # refined by real answers). Questions added without a calibration fall back to their label.
    true_b = {qid: (b if b else DIFF_B.get(d, 0.0)) for qid, b, d in db.execute(
        select(Question.id, Question.irt_b, Question.difficulty).where(Question.topic_id.in_(topics)))}
    rng = random.Random(seed)
    conn = db_engine.connect()
    outer = conn.begin()
    sim = Session(bind=conn, join_transaction_mode="create_savepoint", autoflush=False, expire_on_commit=False)

    @event.listens_for(sim, "before_flush")
    def _keep_bank(session, _ctx, _instances):
        # Don't write serve counts / difficulty calibration to real questions: the rows would stay locked for
        # real students until the rollback. Simulated students only ever insert their own rows.
        for inst in list(session.dirty):
            if isinstance(inst, Question):
                session.expire(inst, ["times_served", "irt_b"])

    personas, all_ad, all_base = [], [], []
    answered = 0
    try:
        for name, th, lr, skip in PERSONAS:
            curves: dict[bool, list[list[float]]] = {True: [], False: []}
            reps: list[float] = []
            for k in range(students):
                for adaptive in (True, False):
                    topic = topics[(k + int(adaptive)) % len(topics)]
                    u = User(id=uuid.uuid4(), email=f"sim-{uuid.uuid4().hex[:12]}@simulation.invalid", name="Simulated student")
                    sim.add(u)
                    sim.flush()
                    theta, curve, served, seen = th + rng.gauss(0, 0.2), [learner.P_INIT], 0, set()
                    repeats = 0
                    for _s in range(sessions):
                        if rng.random() < skip:
                            theta -= 0.05
                            curve.append(curve[-1])
                            continue
                        quiz = Quiz(user_id=u.id, title="Simulation", mode="Quiz", types=SIM_TYPES, topic_ids=[topic], n=5,
                                    difficulty_mode="Adaptive" if adaptive else rng.choice(("Easy", "Medium", "Hard")),
                                    status="active", started_at=datetime.now(timezone.utc))
                        sim.add(quiz)
                        sim.flush()
                        quiz_engine._add_next(sim, quiz)
                        while quiz.items and quiz.items[-1].response is None:
                            item = quiz.items[-1]
                            q = sim.get(Question, item.question_id)
                            served += 1
                            repeats += q.id in seen
                            seen.add(q.id)
                            b = true_b.get(q.id, 0.0)
                            correct = rng.random() < 1 / (1 + math.exp(-(theta - b)))
                            quiz_engine.answer(sim, quiz, item, _sim_response(q, correct, rng))
                            answered += 1
                            theta += lr * math.exp(-((theta - b) ** 2) / 1.5) * (1.0 if correct else 0.6)
                        quiz_engine.finish(sim, quiz)
                        m = sim.get(Mastery, (u.id, topic))
                        curve.append(m.p if m else curve[-1])
                    curves[adaptive].append(curve)
                    if adaptive:
                        reps.append(repeats / max(served, 1))
            ad = [round(mean(c[i] for c in curves[True]), 3) for i in range(sessions + 1)]
            base = [round(mean(c[i] for c in curves[False]), 3) for i in range(sessions + 1)]
            all_ad.append(ad)
            all_base.append(base)
            personas.append({"t": name, "a": ad[0], "b": ad[-1], "g": round(ad[-1] - ad[0], 3),
                             "r": f"{round(100 * mean(reps), 1)}%", "curve": ad})
    finally:
        sim.close()
        outer.rollback()
        conn.close()
    from app.models import Topic

    return {
        "mode": "engine", "sessions": sessions,
        "adaptive": [round(mean(c[i] for c in all_ad), 3) for i in range(sessions + 1)],
        "baseline": [round(mean(c[i] for c in all_base), 3) for i in range(sessions + 1)],
        "personas": personas, "synthetic_bank": False,
        "bank_size": len(true_b), "answers": answered, "students": len(PERSONAS) * students * 2,
        "topics": [t.name for t in (db.get(Topic, x) for x in topics) if t],
    }


def execute(db: Session, run_id: uuid.UUID) -> EvalRun:
    run = db.get(EvalRun, run_id)
    run.status, run.started_at, run.error = "running", datetime.now(timezone.utc), ""
    run.pipeline_version = pipeline_version(db)
    db.commit()
    try:
        run_rag_eval(db, run)
        run.question_bank = questions.bank_stats(db)
        run.progress = 0.8
        db.commit()
        run.simulation = run_engine_simulation(db) or {**run_simulation(db), "mode": "model"}
        run.status, run.progress = "completed", 1.0
    except Exception as e:  # noqa: BLE001
        db.rollback()
        run = db.get(EvalRun, run_id)
        run.status, run.error = "failed", str(e)[:1000]
        log.exception("Evaluation run %s failed", run_id)
    run.finished_at = datetime.now(timezone.utc)
    db.commit()
    return run


def next_number(db: Session) -> int:
    return (db.scalar(select(func.max(EvalRun.number))) or 0) + 1


# --------------------------------------------------------------------------- test-set tools

CATEGORIES = ("Textbook page", "Video timestamp", "Slide number", "Diagram / figure")
UNIT_CATEGORY = {"Text": "Textbook page", "Transcript": "Video timestamp", "Slide": "Slide number", "Diagram": "Diagram / figure"}
# Off-material probes: questions no school textbook chapter answers. The pipeline should decline them.
OFF_MATERIAL = [
    "Who won the 2011 Cricket World Cup final?", "What is the current price of gold in Mumbai?",
    "Recommend a good Bollywood movie to watch this weekend.", "What is the capital of Australia?",
    "How do I reset my Instagram password?", "Who is the current CEO of Tata Motors?",
]
DRAFT_SCHEMA = obj({"question": llm.S, "answer": llm.S})


def parse_bool(v) -> bool:
    return str(v).strip().lower() in ("1", "true", "yes", "y", "off", "off-material", "x")


def parse_cases(raw: bytes, filename: str) -> list[dict]:
    """Test-set rows from a CSV (question, expected_answer, expected_locations, category, off_material) or a
    JSON list of objects with the same keys. Locations can be separated by ';' or '|'."""
    import csv
    import io
    import json

    text = raw.decode("utf-8-sig", errors="replace")
    if filename.lower().endswith(".json") or text.lstrip().startswith("["):
        items = json.loads(text)
        if not isinstance(items, list):
            raise ValueError("The JSON file must contain a list of questions.")
    else:
        items = list(csv.DictReader(io.StringIO(text)))
    out = []
    for i, it in enumerate(items, start=1):
        if not isinstance(it, dict):
            raise ValueError(f"Row {i} is not a question object.")
        it = {str(k).strip().lower(): v for k, v in it.items() if k}
        q = str(it.get("question") or "").strip()
        if not q:
            continue
        if len(q) < 5:
            raise ValueError(f"Row {i}: the question is too short.")
        locs = it.get("expected_locations") or ""
        if isinstance(locs, str):
            locs = [x.strip() for x in re.split(r"[;|]", locs) if x.strip()]
        cat = str(it.get("category") or "Textbook page").strip()
        if cat not in CATEGORIES:
            raise ValueError(f"Row {i}: category must be one of {', '.join(CATEGORIES)}.")
        out.append({"question": q[:2000], "expected_answer": str(it.get("expected_answer") or "").strip()[:4000],
                    "expected_locations": [str(x)[:120] for x in locs][:6], "category": cat,
                    "off_material": parse_bool(it.get("off_material", ""))})
    if not out:
        raise ValueError("No questions found. Use the template's column names.")
    return out


def draft_cases(db: Session, subject_id: uuid.UUID | None, n: int = 12, off: int = 3) -> list[dict]:
    """Drafts test questions from the knowledge base: one per sampled unit, spread across topics, each with the
    unit's real location as the expected source. Staff review and edit them before relying on the numbers."""
    from app.models import ContentUnit, KbSource

    q = (select(ContentUnit).join(KbSource, ContentUnit.source_id == KbSource.id)
         .where(KbSource.origin == "admin", KbSource.status.in_(retrieval.READY), ContentUnit.topic_id.is_not(None),
                func.length(ContentUnit.text) > 120))
    if subject_id:
        q = q.where(KbSource.subject_id == subject_id)
    units = list(db.scalars(q.order_by(func.random()).limit(n * 6)))
    by_topic: dict[uuid.UUID, list] = {}
    for u in units:
        by_topic.setdefault(u.topic_id, []).append(u)
    picked = []
    while len(picked) < n and any(by_topic.values()):
        for lst in by_topic.values():
            if lst and len(picked) < n:
                picked.append(lst.pop())
    existing = {c.lower() for c in db.scalars(select(EvalCase.question))}
    out = []
    for u in picked:
        try:
            d = llm.chat([
                {"role": "system", "content": (
                    "Write one exam-style question a school student might ask, answerable ONLY from this excerpt, and "
                    "its correct answer in 1-3 sentences taken from the excerpt. Do not mention 'the excerpt'.")},
                {"role": "user", "content": f"Excerpt ({u.location}):\n{u.text[:1800]}"}],
                task="eval_draft_case", schema=DRAFT_SCHEMA, temperature=0.3)
        except LLMError as e:
            raise ValueError(f"The AI model is unavailable: {e}") from e
        qt, ans = str(d.get("question") or "").strip(), str(d.get("answer") or "").strip()
        if len(qt) < 8 or not ans or qt.lower() in existing:
            continue
        existing.add(qt.lower())
        out.append({"question": qt, "expected_answer": ans, "expected_locations": [u.location],
                    "category": UNIT_CATEGORY.get(u.kind, "Textbook page"), "off_material": False, "subject_id": subject_id})
    for qt in [x for x in OFF_MATERIAL if x.lower() not in existing][:off]:
        out.append({"question": qt, "expected_answer": "", "expected_locations": [], "category": "Textbook page",
                    "off_material": True, "subject_id": subject_id})
    return out


# --------------------------------------------------------------------------- question bank for the simulation

def bank_by_topic(db: Session) -> list[dict]:
    """Verified, auto-gradable (MCQ / numerical) questions per published topic."""
    from app.models import Chapter, Subject, Topic

    counts = dict(db.execute(select(Question.topic_id, func.count()).where(
        Question.status == "verified", Question.qtype.in_(SIM_TYPES)).group_by(Question.topic_id)).all())
    rows = db.execute(select(Topic, Chapter, Subject).join(Chapter, Topic.chapter_id == Chapter.id)
                      .join(Subject, Chapter.subject_id == Subject.id)
                      .where(Topic.published.is_(True), Chapter.published.is_(True))
                      .order_by(Subject.name, Chapter.position, Topic.position)).all()
    return [{"topic_id": str(t.id), "topic": t.name, "chapter": c.name, "subject": s.name,
             "verified": int(counts.get(t.id, 0)), "ready": counts.get(t.id, 0) >= MIN_BANK} for t, c, s in rows]


PREP_STALE = timedelta(minutes=30)
PREP_ROUNDS = 6


def bank_prep_state(db: Session) -> dict | None:
    """Progress of the last 'prepare question bank' job. A job with no progress for 30 minutes (worker restarted
    mid-run) is reported as stopped so it can be started again."""
    from app.models import AppSetting

    st = db.get(AppSetting, "bank_prep")
    v = dict(st.value or {}) if st else None
    if v and v.get("status") in ("queued", "running"):
        ts = v.get("updated_at") or v.get("started_at")
        if ts and datetime.now(timezone.utc) - datetime.fromisoformat(ts) > PREP_STALE:
            v["status"], v["stopped"] = "done", True
    return v


def prepare_bank(db: Session, per_topic: int = 10) -> dict:
    """Tops up every published topic to `per_topic` verified MCQ/numerical questions (generated from the topic's
    class material and checked by the second model), so the personalisation simulation can run on the real quiz
    engine. Progress is kept in app_settings['bank_prep']."""
    from app.models import AppSetting, Topic

    todo = [r for r in bank_by_topic(db) if r["verified"] < per_topic]
    state = {"status": "running", "done": 0, "total": len(todo), "generated": 0, "skipped": [],
             "started_at": datetime.now(timezone.utc).isoformat()}

    def save():
        s = db.get(AppSetting, "bank_prep") or AppSetting(key="bank_prep", value={})
        s.value = {**state, "updated_at": datetime.now(timezone.utc).isoformat()}
        db.merge(s)
        db.commit()

    save()
    for r in todo:
        t = db.get(Topic, uuid.UUID(r["topic_id"]))
        have = r["verified"]
        try:
            # A model returns fewer questions than asked, and some fail verification or are near-duplicates:
            # keep topping up until the target is met or a round adds nothing new.
            for _ in range(PREP_ROUNDS):
                res = questions.generate(db, t, per_topic - have, SIM_TYPES)
                added = int(res.get("verified", 0))
                state["generated"] += added
                have += added
                if have >= per_topic or not added:
                    break
            if have < MIN_BANK:
                state["skipped"].append(f"{r['topic']} (only {have} verified: add more material)")
        except questions.NoMaterial:
            state["skipped"].append(r["topic"])
        except LLMError as e:
            state["skipped"].append(f"{r['topic']} (AI error: {str(e)[:80]})")
        state["done"] += 1
        save()
    state["status"] = "done"
    state["finished_at"] = datetime.now(timezone.utc).isoformat()
    save()
    return state


# --------------------------------------------------------------------------- report export

def _pct(v) -> str:
    return "—" if v is None else f"{v:.2f}"


def report_markdown(run: EvalRun) -> str:
    m = run.metrics or {}
    vals, tg, ex = m.get("values", {}), m.get("targets", TARGETS), m.get("extra", {})
    when = (run.finished_at or run.created_at)
    lines = [f"# IntelliNova evaluation report: run {run.number}", "",
             f"- Date: {when.strftime('%d %b %Y %H:%M UTC') if when else '—'}",
             f"- Framework requested: **{run.framework}**; scored by: **{m.get('engine', '—')}**",
             f"- Pipeline: `{run.pipeline_version}`"]
    if ex.get("models"):
        mm = ex["models"]
        lines.append(f"- Models: answers `{mm.get('answer')}`, judge `{mm.get('judge')}`, embeddings `{mm.get('embeddings')}`, "
                     f"re-ranker `{mm.get('rerank')}`, top-k {mm.get('k')}, context {mm.get('num_ctx')} tokens")
    lines.append(f"- Test set: {m.get('n_cases', 0)} questions ({m.get('n_off', 0)} off-material)")
    if m.get("engine_note"):
        lines.append(f"- Note: {m['engine_note']}")
    lines += ["", "## Retrieval and generation", "", "| Metric | Score | Target | Met |", "|---|---|---|---|"]
    for k in ("faith", "relev", "cprec", "crec", "cite", "refuse"):
        v = vals.get(k)
        lines.append(f"| {LABELS[k]} | {_pct(v)} | {tg.get(k, 0):.2f} | {'—' if v is None else ('yes' if v >= tg.get(k, 0) else 'no')} |")
    if ex:
        lines += ["", f"- In-material questions answered (not declined): {_pct(ex.get('answered'))}",
                  f"- Response time: average {ex.get('latency_avg_s', '—')} s, 90th percentile {ex.get('latency_p90_s', '—')} s"]
    if run.categories:
        lines += ["", "## By source location type", "", "| Type | N | Faithfulness | Relevancy | Ctx precision | Ctx recall |",
                  "|---|---|---|---|---|---|"]
        for c in run.categories:
            lines.append(f"| {c['l']} | {c['n']} | {_pct(c.get('faith'))} | {_pct(c.get('relev'))} | {_pct(c.get('cprec'))} | {_pct(c.get('crec'))} |")
    if m.get("cases"):
        lines += ["", "## Per question", "", "| # | Question | Status | Faith. | Relev. | C.prec | C.rec | Cite | Expected | Cited | s |",
                  "|---|---|---|---|---|---|---|---|---|---|---|"]
        for i, c in enumerate(m["cases"], start=1):
            q = c["q"].replace("|", "/")[:90] + (" *(off-material)*" if c.get("off") else "")
            lines.append(f"| {i} | {q} | {c['status']} | {_pct(c.get('faith'))} | {_pct(c.get('relev'))} | {_pct(c.get('cprec'))} | "
                         f"{_pct(c.get('crec'))} | {_pct(c.get('cite'))} | {', '.join(c.get('expected') or []) or '—'} | "
                         f"{', '.join(c.get('cited') or []) or '—'} | {c.get('latency_s', '—')} |")
    if run.failures:
        lines += ["", "## Weakest answers", ""] + [f"- **{f['m']}** ({_pct(f.get('score'))}): {f['q']}: {f['w']}" for f in run.failures]
    qb = run.question_bank or {}
    if qb:
        lines += ["", "## Question bank checks", "",
                  f"- Generated {qb.get('generated', 0)}, verified by both checks {qb.get('verified', 0)}, "
                  f"models disagreed {qb.get('disagreement', 0)}, rejected by solver {qb.get('rejected', 0)}, "
                  f"near-duplicates removed {qb.get('duplicate', 0)}"]
    sim = run.simulation or {}
    if sim:
        mode = ("the live quiz engine" + (f" on {', '.join(sim.get('topics') or [])}" if sim.get("topics") else "")
                if sim.get("mode") == "engine" else "a statistical student model (not enough verified questions yet)")
        ad, base = sim.get("adaptive") or [0], sim.get("baseline") or [0]
        lines += ["", "## Personalisation (simulated students)", "",
                  f"Simulated with {mode}: {len(sim.get('personas', []))} profiles × {sim.get('sessions')} sessions"
                  + (f", {sim.get('students')} students, {sim.get('answers')} answers" if sim.get("answers") else "") + ".", "",
                  f"- Mean mastery gain, adaptive: **+{ad[-1] - ad[0]:.2f}** (from {ad[0]:.2f} to {ad[-1]:.2f})",
                  f"- Mean mastery gain, fixed-difficulty baseline: +{base[-1] - base[0]:.2f}", "",
                  "| Profile | Start | End | Gain | Question repetition |", "|---|---|---|---|---|"]
        for p in sim.get("personas", []):
            lines.append(f"| {p['t']} | {p['a']:.2f} | {p['b']:.2f} | +{p['g']:.2f} | {p['r']} |")
    lines += ["", "_Generated by IntelliNova's evaluation harness. All models ran locally._", ""]
    return "\n".join(lines)


def report_csv(run: EvalRun) -> str:
    import csv
    import io

    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["question", "off_material", "category", "status", "faithfulness", "answer_relevancy", "context_precision",
                "context_recall", "citation_accuracy", "expected_locations", "cited_locations", "latency_s", "answer", "reference"])
    for c in (run.metrics or {}).get("cases", []):
        w.writerow([c["q"], c.get("off"), c.get("category"), c.get("status"), c.get("faith"), c.get("relev"), c.get("cprec"),
                    c.get("crec"), c.get("cite"), "; ".join(c.get("expected") or []), "; ".join(c.get("cited") or []),
                    c.get("latency_s"), c.get("answer"), c.get("reference")])
    return buf.getvalue()
