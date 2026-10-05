import logging
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import EvalRun
from app.routers import auth, explore, home, learn, me, plan, practice, search, study, tutor
from app.routers.admin import catalog, curriculum, kb, overview, people

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("intellinova")

@asynccontextmanager
async def lifespan(_app: FastAPI):
    from app.services import tts

    tts.ensure_voices_async()  # one-time background download of the English/Hindi voices
    yield


app = FastAPI(title="IntelliNova API", version="1.0.0", docs_url="/api/docs", openapi_url="/api/openapi.json",
              lifespan=lifespan)

for r in (auth, me, learn, search, tutor, practice, study, explore, home, plan, overview, kb, curriculum, catalog, people):
    app.include_router(r.router)


@app.get("/api/health")
def health():
    return {"ok": True}


@app.get("/api/public/quality")
def public_quality(db: Session = Depends(get_db)):
    """Latest completed evaluation run, for the landing page's accuracy section."""
    run = db.scalar(select(EvalRun).where(EvalRun.status == "completed").order_by(EvalRun.number.desc()).limit(1))
    if not run:
        return {"available": False}
    v = (run.metrics or {}).get("values", {})

    def pct(x):
        return f"{round(x * 100)}%" if isinstance(x, (int, float)) else None

    items = [(pct(v.get("faith")), "Answers that stick to the source"), (pct(v.get("relev")), "Answers that address the question"),
             (pct(v.get("cprec")), "Right material found first time"), (pct(v.get("refuse")), "Out-of-syllabus questions caught")]
    return {"available": True, "run": run.number, "date": run.finished_at.strftime("%-d %b %Y") if run.finished_at else "",
            "cases": (run.metrics or {}).get("n_cases"), "metrics": [{"v": a, "l": b} for a, b in items if a]}


@app.exception_handler(RequestValidationError)
async def validation_error(request: Request, exc: RequestValidationError):
    errs = exc.errors()
    first = errs[0] if errs else {}
    field = ".".join(str(x) for x in first.get("loc", [])[1:]) or "request"
    return JSONResponse({"detail": f"{field}: {first.get('msg', 'invalid value')}", "errors": jsonable_encoder(errs, custom_encoder={Exception: str})}, status_code=422)


@app.exception_handler(Exception)
async def unhandled(request: Request, exc: Exception):
    log.exception("Unhandled error on %s %s", request.method, request.url.path)
    return JSONResponse({"detail": "Something went wrong on our side. Try again."}, status_code=500)
