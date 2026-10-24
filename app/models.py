import re
from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator

# L1: cheap regex screen for the most common direct-injection phrasings. The
# llm-guard / heuristic scan (L2) catches what these miss.
INJECTION_PATTERNS = [
    r"(?i)(ignore\s+(all\s+)?previous|ignore\s+above|forget\s+your\s+instructions)",
    r"(?i)(system\s*prompt|reveal\s+your\s+instructions|show\s+your\s+prompt)",
    r"(?i)(you\s+are\s+now|new\s+instructions|override\s+previous)",
    r"(?i)(<\s*script|javascript:|on\w+\s*=)",
]


def _screen(value: str, field: str) -> str:
    value = value.strip()
    if not value:
        raise ValueError(f"{field} cannot be empty or whitespace only")
    for pattern in INJECTION_PATTERNS:
        if re.search(pattern, value):
            raise ValueError(f"{field} contains potentially malicious content")
    if re.match(r"^[\W_]+$", value):
        raise ValueError(f"{field} must contain actual text content")
    return value


class ChatRequest(BaseModel):
    message: str = Field(
        ...,
        min_length=1,
        max_length=2000,
        description="User message to the AI assistant",
    )
    @field_validator("message")
    @classmethod
    def validate_message_content(cls, v: str) -> str:
        return _screen(v, "Message")


class RetrievedChunkPreview(BaseModel):
    text: str
    source: str
    score: float = 0.0

class TraceStep(BaseModel):
    """One stage of the request pipeline, in the order it ran."""

    name: str
    layer: str | None = None
    status: str = "ok"
    ms: float = 0.0
    detail: dict[str, Any] = Field(default_factory=dict)


class ResponseMetadata(BaseModel):
    route: str = "rag"
    retrieved_chunks: list[RetrievedChunkPreview] = Field(default_factory=list)
    cache_hit: bool = False
    reflection_iterations: int = 0
    reflection_score: float | None = None
    refined_question: str | None = None
    crag_score: float | None = None
    crag_label: str | None = None
    used_web_fallback: bool = False
    sql: str | None = None
    sql_rows: list[dict[str, Any]] = Field(default_factory=list)
    trace: list[TraceStep] = Field(default_factory=list)
    total_ms: float | None = None
    # Follow-ups: the self-contained question actually searched (None if unchanged).
    standalone_question: str | None = None


class PendingSQLBlock(BaseModel):
    sql: str
    query_id: str
    explanation: str = ""


class ChatResponse(BaseModel):
    answer: str = Field(..., min_length=0)
    sources: list[str] = Field(default_factory=list)
    confidence: float = Field(..., ge=0.0, le=1.0)
    pending_sql: PendingSQLBlock | None = None
    cache_hit: bool = False
    cost_saved: str = "$0.00"
    metadata: ResponseMetadata = Field(default_factory=ResponseMetadata)
    conversation_id: str | None = None
    message_id: str | None = None


class QueryRequest(BaseModel):
    question: str = Field(
        ...,
        min_length=1,
        max_length=2000,
        description="User question",
    )
    enable_rerank: bool = True
    top_k: int = Field(default=5, ge=1, le=50)
    enable_hyde: bool = False
    search_mode: Literal["dense", "sparse", "hybrid"] = "hybrid"
    enable_crag: bool = True
    enable_self_reflective: bool = False
    bypass_cache: bool = False
    # Continue a saved conversation (follow-ups); omit to start a new one.
    conversation_id: str | None = Field(default=None, max_length=64)

    @field_validator("question")
    @classmethod
    def validate_question_content(cls, v: str) -> str:
        return _screen(v, "Question")


class RetrievedChunk(BaseModel):
    text: str
    source: str
    score: float = 0.0

class CRAGEvaluation(BaseModel):
    relevance_score: float = 0.0
    relevance_label: str = ""
    confidence: float = 0.0
    reasoning: str = ""
    passage_scores: list[float] = Field(default_factory=list)


class ReflectionResult(BaseModel):
    """Self-RAG reflection on a generated answer."""

    reflection_score: float = 0.0
    needs_regeneration: bool = False
    refined_question: str = ""
    reasoning: str = ""


class SqlExecuteRequest(BaseModel):
    query_id: str = Field(..., min_length=1, max_length=64)
    approved: bool


class AuthRequest(BaseModel):
    username: str = Field(..., min_length=3, max_length=64, pattern=r"^[A-Za-z0-9._@+-]+$")
    password: str = Field(..., min_length=6, max_length=128)
