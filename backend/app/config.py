from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "postgresql+psycopg://intellinova:devpw@localhost:5432/intellinova"
    redis_url: str = "redis://localhost:6379/0"
    meili_url: str = "http://localhost:7700"
    meili_master_key: str = ""
    gotrue_url: str = "http://localhost:9999"
    jwt_secret: str = "dev-secret-change-me-dev-secret-change-me"
    jwt_audience: str = "authenticated"

    public_url: str = "http://localhost"
    cookie_secure: bool = False
    # If set, creating the very first admin account requires this token, so a
    # fresh deployment can't be claimed by whoever reaches /admin/signup first.
    admin_bootstrap_token: str = ""
    invite_ttl_days: int = 7
    storage_dir: str = "/data/uploads"

    # AI
    ollama_url: str = "http://localhost:11434"
    llm_model: str = "llama3.1:8b"
    verifier_model: str = "qwen2.5:7b"
    vision_model: str = "llava:7b"
    llm_timeout_s: float = 180.0
    llm_num_ctx: int = 8192  # tokens the model reads at once (Ollama's default is too small for our prompts)
    llm_keep_alive: str = "30m"  # how long Ollama keeps a model in GPU memory after the last request
    embeddings_backend: str = "sentence-transformers"  # sentence-transformers | ollama | hash (tests only)
    embeddings_model: str = "intfloat/multilingual-e5-small"
    embed_dim: int = 384
    whisper_model: str = "small"
    whisper_device: str = "cpu"  # cpu is plenty for short questions; cuda needs CUDA 12 + cuDNN 9 in the image
    piper_voice_dir: str = "/models/piper"
    piper_auto_download: bool = True  # fetch an English + Hindi voice once, in the background

    # Retrieval / grounding
    retrieval_k: int = 6
    # Multilingual cross-encoder that re-orders the retrieved passages by how well they answer the
    # question (empty = off). Downloaded once into the models volume; runs on CPU in ~0.5 s.
    rerank_model: str = "cross-encoder/mmarco-mMiniLMv2-L12-H384-v1"
    grounding_min_support: float = 0.6
    dedup_threshold: float = 0.92

    # Optional signals
    youtube_api_key: str = ""

    # Automatic video discovery: when a topic has fewer than `discovery_min_videos` catalog videos,
    # search YouTube (Data API if youtube_api_key is set, else yt-dlp), check each candidate against the
    # syllabus topic with the local LLM, rank, and add the best ones marked as "found automatically".
    discovery_enabled: bool = True
    discovery_min_videos: int = 3
    discovery_ttl_days: int = 14
    discovery_candidates: int = 15
    discovery_judge: int = 8
    discovery_max_results: int = 5
    discovery_min_relevance: float = 0.6

    # Reddit as an optional, never load-bearing community signal (non-commercial free tier only).
    # Active only when both keys are set.
    reddit_client_id: str = ""
    reddit_client_secret: str = ""
    reddit_user_agent: str = "IntelliNova/1.0 (school study app; non-commercial)"
    reddit_subreddits: str = "CBSE+JEENEETards+Indian_Academia+IndianStudents+ICSE"
    posthog_host: str = ""
    posthog_api_key: str = ""

    # Celery: run tasks inline (tests / single-process dev)
    celery_eager: bool = False


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
