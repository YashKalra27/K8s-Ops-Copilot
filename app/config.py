import secrets

from loguru import logger
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # LLM + embeddings. Any OpenAI-compatible endpoint works: leave OPENAI_BASE_URL
    # empty for OpenAI, or point it at Ollama (http://localhost:11434/v1) to run
    # fully locally with no API key.
    openai_api_key: str = ""
    openai_base_url: str = ""
    llm_model_answer: str = "gpt-4o"
    llm_model_grader: str = "gpt-4o-mini"
    embedding_model: str = "text-embedding-3-small"
    embedding_dim: int = 1536
    # Some embedding models are trained with task prefixes and retrieve much
    # worse without them (nomic-embed-text: "search_query: " / "search_document: ").
    embedding_query_prefix: str = ""
    embedding_document_prefix: str = ""
    llm_timeout_seconds: float = 120.0

    # Qdrant: server mode (QDRANT_URL) or embedded on-disk mode (QDRANT_PATH),
    # which needs no Docker. QDRANT_PATH wins when both are set.
    qdrant_url: str = "http://localhost:6333"
    qdrant_path: str = ""
    qdrant_collection: str = "documents"

    database_url: str = "postgresql://postgres:postgres@localhost:5432/adv_rag"

    # Cache / rate-limit store: Upstash (REST) if configured, else a plain Redis
    # (REDIS_URL, e.g. redis://localhost:6379/5), else an in-process fallback.
    upstash_redis_url: str = ""
    upstash_redis_token: str = ""
    redis_url: str = ""
    cache_ttl_embeddings: int = 604_800
    cache_ttl_rag: int = 3_600
    cache_ttl_sql_gen: int = 86_400
    cache_ttl_sql_result: int = 900
    cache_ttl_intent: int = 86_400

    storage_backend: str = "local"
    local_storage_dir: str = "./cache"
    s3_cache_bucket: str = "adv-rag-cache"
    aws_region: str = "us-east-1"

    tavily_api_key: str = ""

    jwt_secret: str = ""
    jwt_expiration_minutes: int = 60

    rate_limit_requests: int = 20
    rate_limit_window_seconds: int = 60
    max_tokens_per_user_daily: int = 100_000
    auth_login_rate_limit_per_min: int = 5
    auth_register_rate_limit_per_hour: int = 3

    max_input_tokens: int = 3_000
    reserved_context_tokens: int = 1_000
    reserved_output_tokens: int = 1_000

    # Security scanners. "auto" uses llm-guard when it is installed and falls back
    # to the built-in heuristic rules otherwise. LLM_GUARD_SCANNERS picks which
    # llm-guard models to load (each one is a few hundred MB of RAM).
    input_guard_backend: str = "auto"  # auto | llm_guard | heuristic
    llm_guard_scanners: str = "prompt_injection,toxicity,ban_topics"
    pii_backend: str = "auto"  # auto | llm_guard | regex
    prompt_injection_threshold: float = 0.75
    toxicity_threshold: float = 0.75
    output_toxicity_threshold: float = 0.5
    max_validation_retries: int = 2

    hyde_num_hypotheses: int = 3
    hyde_enabled_by_default: bool = False
    hybrid_search_enabled: bool = True
    rrf_k: int = 60
    reranker_backend: str = "local"
    reranker_model: str = "cross-encoder/ms-marco-MiniLM-L-6-v2"
    voyage_api_key: str = ""
    voyage_model: str = "rerank-2.5"
    reranker_initial_top_k: int = 20
    reranking_enabled_by_default: bool = True
    crag_relevance_threshold: float = 0.7
    crag_ambiguous_threshold: float = 0.5
    crag_enabled_by_default: bool = True
    reflection_min_score: float = 0.85
    max_reflection_retries: int = 2
    self_reflective_enabled_by_default: bool = False

    # Document parsing: docling (layout-aware, heavy) or simple (pypdf/docx/html text).
    doc_parser: str = "docling"  # docling | simple
    max_upload_mb: int = 20

    vanna_model: str = "gpt-4o"
    vanna_temperature: float = 0.0
    vanna_seed: int = 42
    sql_statement_timeout_ms: int = 5_000
    sql_max_rows: int = 200

    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"
    warmup_on_startup: bool = False

    log_json: bool = False
    log_level: str = "INFO"


settings = Settings()

if not settings.jwt_secret:
    # Never sign tokens with an empty key. A random per-process secret keeps the
    # service safe; tokens simply stop working after a restart.
    settings.jwt_secret = secrets.token_urlsafe(48)
    logger.warning("JWT_SECRET is not set; using a random secret for this process only")
