from celery import Celery
from celery.schedules import crontab

from app.config import settings

celery = Celery("intellinova", broker=settings.redis_url, backend=settings.redis_url, include=["app.workers.tasks"])
celery.conf.update(
    task_always_eager=settings.celery_eager,
    task_eager_propagates=False,
    task_acks_late=True,
    worker_prefetch_multiplier=1,
    task_default_queue="default",
    task_routes={
        "app.workers.tasks.ingest_source": {"queue": "ingest"},
        "app.workers.tasks.generate_material": {"queue": "ai"},
        "app.workers.tasks.prepare_quiz": {"queue": "ai"},
        "app.workers.tasks.generate_questions": {"queue": "ai"},
        "app.workers.tasks.chat_evidence": {"queue": "feedback"},
        "app.workers.tasks.refresh_signals": {"queue": "signal"},
        "app.workers.tasks.discover_videos": {"queue": "signal"},
        "app.workers.tasks.fit_bkt": {"queue": "feedback"},
        "app.workers.tasks.run_eval": {"queue": "eval"},
        "app.workers.tasks.prepare_question_bank": {"queue": "eval"},
    },
    beat_schedule={
        "check-resource-links": {"task": "app.workers.tasks.check_links", "schedule": crontab(hour=2, minute=17)},
        "youtube-engagement-signal": {"task": "app.workers.tasks.refresh_signals", "schedule": crontab(hour=3, minute=5)},
        "refit-bkt-parameters": {"task": "app.workers.tasks.fit_bkt", "schedule": crontab(day_of_week=0, hour=4, minute=0)},
        "rebuild-search-index": {"task": "app.workers.tasks.reindex_search", "schedule": crontab(hour=1, minute=40)},
    },
)
app = celery
