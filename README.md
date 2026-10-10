# IntelliNova

An AI study partner for school students, and the admin console that keeps it accurate.

- **Student app** (`/app`):
  - **Tutor.** Answers come from class material, with a citation on every point that opens the exact page, slide, figure or video moment. When the material doesn't cover a question, the tutor says so; with *Sources only* off it adds a short general answer, clearly labelled as outside the material. You can type or talk: hands-free voice mode listens, answers aloud and listens again, with speech recognised on your own server by Whisper. Students choose what the tutor answers from (all their material, one subject, one chapter, only their own uploads, or particular files) and can change it mid-conversation.
  - **Practice.** Adaptive practice and mock exams.
  - **Study AI.** Notes, flashcards, concept maps, audio briefs and a downloadable slide deck from a lecture, PDF, slides or pasted text. One-click **revision packs** do the same for your weak topics, built from class material.
  - **Course flow map.** Every topic in teaching order with its prerequisite arrows, coloured by your mastery.
  - **Study plan.** Give your exam date and get a day-by-day schedule built from weak topics and forgetting curves. It is rebuilt every day and feeds "Today's plan".
  - **Also:** exam prep and a career explorer.
- **Admin console** (`/admin`):
  - **Knowledge base.** Ingestion and tag review. Topics and subtopics found in uploaded material are **suggested for the curriculum**.
  - **Evaluation harness.** RAGAS, DeepEval or TruLens, plus simulated students driven through the real quiz engine.
  - **Curriculum.** Editing with versioned publishing and a flow-map view.
  - **Everything else.** The resource catalog, exams with verified facts, career data, review of generated content, users and invites, privacy requests and analytics.
- **Landing page** (`/`), plus `/privacy` and `/terms`.

Everything runs on your own servers. The language, vision, speech and embedding models are open-source models served locally, so no student data goes to a third-party AI API.

---

## Quick start (Docker)

Requirements: Docker with Compose v2, and about 16 GB of RAM for the default 7–8B models. A GPU is optional but makes answers much faster.

```bash
cp .env.example .env
# Edit .env: set every "change-me" value (openssl rand -hex 32), and ADMIN_BOOTSTRAP_TOKEN.
docker compose --profile dev up -d --build     # "dev" also starts Mailpit to catch emails

# Pull the local models once (they are stored in the "ollama" volume)
docker compose exec ollama ollama pull llama3.1:8b    # tutor, notes, question generation
docker compose exec ollama ollama pull qwen2.5:7b     # second-model answer-key verification
docker compose exec ollama ollama pull llava:7b       # reading diagrams and figures
```

With an NVIDIA GPU, copy `docker-compose.gpu.example.yml` to `docker-compose.override.yml` before starting. Answers get much faster.

Open <http://localhost>. Sign-up emails (6-digit codes, password resets, staff invites) arrive in Mailpit at <http://localhost:8025> until you set real SMTP settings.

The sentence-transformers embedding model (`intfloat/multilingual-e5-small`) and the Whisper model are downloaded on first use into the `models` volume.

### On Windows: double-click to start and stop

The `windows` folder has three shortcuts. Right-click one › **Send to › Desktop** to keep it handy.

| Shortcut | What it does |
|---|---|
| **Start IntelliNova** | Starts Docker Desktop if needed, then the app (built on the first run). It downloads the AI models once and opens <http://localhost>. |
| **Stop IntelliNova** | Stops the app and keeps all data. It can also shut down Docker and WSL to give the memory back to Windows. |
| **Update IntelliNova** | Run after extracting a newer zip over this folder. It rebuilds and applies database changes automatically. |

If you turn on **Docker Desktop › Settings › General › Start Docker Desktop when you sign in**, you don't need **Start** at all. The containers restart by themselves after a reboot, unless you stopped them with **Stop**.

### Create the first admin

1. Go to <http://localhost/admin/signup>. On a fresh install this shows **Create the first admin account**.
2. If `ADMIN_BOOTSTRAP_TOKEN` is set in `.env`, the form asks for it. Set it in production so nobody else can claim the console first.
3. After that, sign-up is **invite-only**. In **Admin › Users › Invite staff**, enter an email and pick a role:
   - **Curator:** edits curriculum, knowledge base, resources, exams, career data and generated content.
   - **Admin:** everything a curator can do, plus users, invites, roles and privacy requests.

   The invitee gets an email with a single-use link (valid `INVITE_TTL_DAYS`, default 7). The link is also shown so you can copy it.

The student app and the admin console keep **separate sessions**, so a student and an admin can be signed in side by side in the same browser.

Students sign up at `/signup` with email and password (confirmed by a 6-digit code). Google sign-in and mobile OTP appear automatically when enabled in `.env`. Student accounts can't open the admin console.

### Videos found automatically

Students don't have to wait for curators to add videos. When a student searches a topic, or opens a chapter whose topics have fewer than `DISCOVERY_MIN_VIDEOS` videos, IntelliNova:

1. searches YouTube for the topic, class, board and the student's language (SafeSearch, Shorts and live streams excluded);
2. keeps only videos the local AI judges to actually teach that syllabus topic, using the title, description and captions;
3. ranks them by how well they teach it, likes and views, captions, trusted channels and (optionally) Reddit mentions;
4. shows the best right away with an **Auto-found** badge and a "why" line. Curated videos always rank first.

Free-text searches outside the syllabus (for example "photosynthesis" when the curriculum has no such topic) are checked first, so non-study searches like "cricket score" never reach YouTube. Each student is limited to 15 free-text discoveries a day, and every topic search is cached for 14 days.

Staff see every search in **Resources › Search log** (found → passed filters → judged relevant → added, or the error). **Resources › Auto-found** lists what was added, and setting one to **Disabled** removes it for good. **Curriculum › topic › Find videos on YouTube** searches on demand. Set `DISCOVERY_ENABLED=false` to turn it all off.

Get a free YouTube Data API key (Google Cloud Console → YouTube Data API v3) for the best results. Without one, yt-dlp is used, which has no quota but depends on YouTube's public pages.

### First content, in order

1. **Curriculum:** add a subject (board, class, subject), its chapters and topics, and prerequisites, then **Publish**. Students only see published chapters.
2. **Knowledge base:** upload textbook PDFs, slide decks or lecture videos (or YouTube links). Each goes through the stages Transcribe/OCR, Figures, Segment, Tag topics (with subtopics), Identify topics and Index.
   - Review low-confidence tags.
   - If the material covers topics the curriculum doesn't have yet, they appear under **Suggested topics**. **Add to curriculum** creates the chapter/topic as a draft with its subtopics and tags the material to it.
3. **Resources:** paste a YouTube or web link. The wizard detects metadata, suggests the chapter and topics, and adds it to recommendations.
4. **Exams** and **Career data:** structure, verified facts with official sources, and eligibility rules.
5. **Evaluation:** build a held-out test set (including off-material questions), prepare the question bank, and run the harness before each update. See [Evaluation](#evaluation) below.

### Evaluation

**Admin › Evaluation** has three tabs.

- **Test set.** The held-out questions the harness scores. Each in-material question has a reference answer and the page, slide or timestamp where the answer is. Off-material questions check that the tutor declines.
  - **Import** a CSV or JSON file written by your team. Download the **CSV template** from the same dialog. Separate several locations with `;`.
  - **Draft from material** writes questions from processed sources, each tagged with its real location. Check and edit them before you rely on the numbers.
  - `samples/eval-testset-electricity.csv` is a ready test set (26 questions) for `samples/IntelliNova-sample-Electricity.pdf`. See `samples/README.md`.
- **Question bank.** The simulated-student check runs on the real quiz engine once a topic has 8 or more verified MCQ/numerical questions. **Prepare** writes them from each topic's material and verifies every one with the second model and the solver. Without them, the simulation falls back to a statistical model and says so.
- **Results.** Pick RAGAS, DeepEval or TruLens and **Run evaluation**. You get:
  - the six headline metrics with targets and trend;
  - the share of questions answered, average and 90th-percentile response time, and the models used;
  - scores by source type and the weakest answers;
  - **per-question results** (the tutor's answer next to the reference, expected vs cited locations);
  - question-bank checks and the simulated-student curves.

  **Report** (Markdown) and **CSV** download the whole run.

### Answer quality settings

Set these in `.env`, then run `docker compose up -d`.

| Setting | Default | What it does |
|---|---|---|
| `LLM_NUM_CTX` | 8192 | Context window sent to Ollama. Its own default is small and silently cuts long prompts, so answers stop following the sources. |
| `LLM_KEEP_ALIVE` | 30m | Keeps the model loaded between questions. |
| `RERANK_MODEL` | multilingual MiniLM cross-encoder | Re-orders retrieved passages before answering. Empty turns it off (saves about 0.5 GB of RAM). |
| `VERIFIER_MODEL` | qwen2.5:7b | Question checker and evaluation judge. `deepseek-r1:7b` works too: its thinking is removed automatically. |
| `PIPER_AUTO_DOWNLOAD` | true | Downloads the English and Hindi Piper voices (about 120 MB) on first start. |

### Going to production

- `SITE_ADDRESS=learn.yourschool.org` gives automatic HTTPS through Caddy. Then set `PUBLIC_URL=https://learn.yourschool.org` and `COOKIE_SECURE=true`.
- Set real `SMTP_*` values and `MAILER_AUTOCONFIRM=false`.
- Optional: `YOUTUBE_API_KEY` for richer video metadata and engagement signals; `GOOGLE_*` or `PHONE_*` for extra sign-in methods; `POSTHOG_*` for self-hosted product analytics.
- Optional heavier extras (Docling PDF layout parsing, pyBKT refits): `docker compose build --build-arg EXTRAS=1 api worker beat`. The RAGAS / DeepEval / TruLens packages and Piper are installed by default; build with `--build-arg EVAL=0` to leave the evaluation frameworks out of a smaller image.
- Back up the `pgdata`, `uploads` and `meilidata` volumes. The search index can be rebuilt from Postgres (the beat schedule reindexes nightly).

---

## Architecture

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

## Local development (without Docker for the app)

Start the backing services with Docker, or run your own Postgres (pgvector), Redis, Meilisearch, GoTrue and Mailpit:

```bash
# Backend
cd backend
python -m venv .venv && . .venv/bin/activate
pip install -r requirements-dev.txt
cp ../.env.example .env   # point DATABASE_URL, REDIS_URL, MEILI_URL, GOTRUE_URL at your services
alembic upgrade head
uvicorn app.main:app --reload --port 8000
celery -A app.workers.celery_app worker -l info -Q ingest,ai,signal,feedback,eval,default   # or CELERY_EAGER=true

# Web (proxies /api to localhost:8000; override with API_INTERNAL_URL)
cd web && npm ci && npm run dev    # http://localhost:3000
```

GoTrue must be able to reach the API for its email templates (`/api/auth/email-templates/*`) and must share `JWT_SECRET`. See the `gotrue` service in `docker-compose.yml` for the full set of variables.

### Running the tests

The backend tests are integration tests against real Postgres with pgvector, Redis, Meilisearch, GoTrue and Mailpit. Only the LLM is replaced by deterministic fakes (`tests/fakes.py`), and Celery tasks run inline. They create users and content, so run them against a throwaway stack, never your live one:

```bash
docker compose -p intellinova-test --profile dev up -d --build
docker compose -p intellinova-test exec api sh -c "pip install --user -q pytest==9.1.1 && MAILPIT_URL=http://mailpit:8025 python -m pytest -q"
docker compose -p intellinova-test down -v
```

Leave `ADMIN_BOOTSTRAP_TOKEN` empty for the test stack. Frontend checks: `cd web && npm run typecheck && npm run build`.

---

## Project layout

```
backend/
  app/
    main.py, config.py, db.py, models.py, security.py, gotrue.py
    routers/        auth, me, learn, search, tutor, practice, study, explore, home, plan
    routers/admin/  overview, kb, curriculum, catalog, people
    services/       llm, embeddings, parsing, ingestion, retrieval, grounding, questions,
                    grading, learner, quiz_engine, notes, tts, stt, slides, resources, search, planner,
                    schedule (exam study plan), flowmap, discovery, reddit, evaluation
    workers/        celery_app, tasks
  alembic/          migrations (extensions, HNSW and trigram indexes)
  tests/            end-to-end API flows, unit tests, LLM fakes
web/
  app/              landing, auth pages, /app (student), /admin (console), /onboarding
  components/       UI kit, shells, tutor, resource cards, admin kit
  scripts/          build-icon-font.py (subsets the Material Symbols font)
infra/              Caddyfile, Postgres init script
windows/            Start / Stop / Update IntelliNova.bat (double-click shortcuts)
samples/            sample textbook PDF and a ready evaluation test set
design/             the original design files this UI was built from
```

## Notes and limits

- Answer quality depends on the local models. `llama3.1:8b` is a sensible default on 16 GB. Larger models (set `LLM_MODEL`) give better notes and questions. Re-run the evaluation after changing models; the landing page's accuracy numbers come from the latest completed run and are hidden until one exists.
- Voice questions load the Whisper model into the API the first time someone speaks. With the default `WHISPER_MODEL=small`, that is about 0.5 GB of RAM, and a short question takes 1–3 seconds on a laptop CPU. Use `base` for less memory, or `medium` for better Hindi.
- Hindi and Hinglish work end to end (multilingual embeddings, Whisper, prompt language). For scanned Hindi textbooks, the image includes Tesseract's Hindi data.
- Class levels are normalised ("10", "Grade 10" and "Class 10" are the same class), so curriculum entered by staff always matches what students pick.
