# IntelliNova: architecture and engineering decisions

Component-by-component detail behind the [README](../README.md) summary.

## Components

```
Caddy ─┬─ /            → web      Next.js 15 (App Router, Tailwind 4, Radix, SWR)
       ├─ /api/*       → api      FastAPI + SQLAlchemy 2 + Alembic
       └─ /auth/v1/*   → gotrue   Supabase GoTrue (email/password, OTP, OAuth, invites)
api / worker / beat ─ Postgres 16 + pgvector · Redis · Meilisearch · Ollama
worker queues: ingest · ai · signal · feedback · eval · default   (Celery 5)
```

| Layer | What is used |
|---|---|
| Auth | GoTrue; FastAPI proxies it and keeps tokens in httpOnly cookies. Roles (student, curator, admin) live in our `users` table. Staff sign-up is invite-only, with a guarded first-admin bootstrap. |
| LLMs | Ollama `/api/chat` with JSON-schema structured output. `LLM_MODEL` for generation, `VERIFIER_MODEL` as a second model for answer-key checks, `VISION_MODEL` for figure captions. |
| Parsing | PyMuPDF (Docling when installed), Tesseract OCR for scanned pages, python-pptx for slides, YouTube captions, then yt-dlp plus faster-whisper, and OpenCV keyframes with OCR for uploaded video. |
| Retrieval | pgvector cosine search plus Postgres full-text, merged by reciprocal-rank fusion (optional cross-encoder re-ranker), over content units that keep their page, slide or timestamp. |
| Grounding | Answers cite `[n]` per claim. A faithfulness check tests each sentence against the sources. With "Sources only" on, unsupported answers are declined; otherwise they are marked as outside the material. |
| Questions | Generated per topic, then re-derived with SymPy (numericals), cross-checked by a second model, and de-duplicated by embedding similarity. |
| Learner model | BKT mastery per topic (pyBKT refit weekly when installed), FSRS revision scheduling (py-fsrs), difficulty targeting and Elo-style item difficulty. |
| Recommendations | Topic coverage, language, quality, YouTube engagement, students' helpful votes and completion, and co-completion, each with a "why" line. |
| Video discovery | When a topic has too few videos, search YouTube (Data API with SafeSearch, or yt-dlp without a key), drop Shorts, live streams, profanity and curator-removed videos, pre-rank by embeddings, have the local LLM judge each shortlisted video against the syllabus topic using title, description and captions, then rank by judge score, engagement, captions, trusted channels and optional Reddit mentions. |
| Community signal (optional) | Reddit via its official API (app-only OAuth), only when `REDDIT_CLIENT_ID`/`SECRET` are set: a small boost and a "Recommended by students on r/…" line for videos shared in study subreddits. Never required. |
| Search | Meilisearch over chapters, topics, resources, exams and careers, with typo tolerance and "did you mean". |
| Evaluation | Faithfulness, answer relevancy, context precision and recall, citation accuracy and off-material handling. The official RAGAS, DeepEval or TruLens package scores the four core metrics when installed; otherwise built-in LLM judges do, and the run says which. Simulated students (six profiles with a hidden IRT ability) take real quizzes through the live quiz engine: question picking, grading, BKT/FSRS updates and repeat avoidance. This runs inside a transaction that is rolled back, comparing adaptive difficulty with a fixed-difficulty baseline. |
| Study plan | For each topic: not yet learned → learn in course order, then practice the next day and review after about 3 and 7 days. Weak or developing (BKT) → targeted practice, weakest first, interleaved with new learning. Mastered → reviewed on the day FSRS predicts recall drops to 90%. The last days are a final-revision window ranked by predicted recall on exam day, ending with a mock test. |
| Slides | python-pptx builds a 16:9 deck from the source-linked notes: key points, one slide per section with definition/example boxes and its source location, formulas, common mix-ups and a self-check. |
| Voice | Whisper (faster-whisper, the same model that transcribes lectures) turns spoken questions into text on the server. Browser speech recognition is the fallback. Piper TTS reads answers and audio briefs, with browser speech synthesis as the fallback. Hands-free mode detects when the student stops talking, so no taps are needed. |
| Frontend | Installable from the browser (web manifest). There is no offline service worker: a cache of pages and scripts mixed old and new builds after updates, so `public/sw.js` now only removes the one older versions installed. Fonts are self-hosted: no requests to Google. |

### Where this differs from the architecture documents

- **LlamaIndex / Haystack:** retrieval is implemented directly in SQL (pgvector plus full-text with RRF). That is fewer moving parts and keeps every chunk tied to its source location.
- **py-irt:** item difficulty uses an Elo/Rasch-style online estimate, updated with every answer instead of batch-fitted.
- **D3:** charts (forgetting curves, simulations, concept maps) are small hand-written SVG components.
- **Label Studio / Refine:** review and editing happen in the purpose-built admin console (KB tag review, generated-content review, catalog editors).
- **PRAW:** Reddit is called through its official OAuth API directly with httpx (no extra dependency), and only when keys are configured.
- **RAGAS / DeepEval / TruLens:** selectable per run on the evaluation page and installed by default (`requirements-eval.txt`). All three use the local verifier model in Ollama as the judge. Any score a framework can't produce (TruLens has no context recall, for example) is filled in by the built-in judges, and the run page says how many.

---
