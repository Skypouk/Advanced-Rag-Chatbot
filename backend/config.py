"""Application configuration.

Every setting is read from an environment variable (or a ``.env`` file) and
falls back to a sensible default, so the backend runs out of the box both
inside Docker Compose and directly on a developer machine.
"""

from functools import lru_cache
from typing import List, Optional

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Strongly-typed application settings loaded from the environment."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=True,
        extra="ignore",
    )

    # ── Ollama ──────────────────────────────────────────────────────────────
    OLLAMA_BASE_URL: str = "http://localhost:11434"
    OLLAMA_LLM_MODEL: str = "llama3"
    OLLAMA_EMBED_MODEL: str = "nomic-embed-text"
    OLLAMA_TEMPERATURE: float = Field(default=0.1, ge=0.0, le=2.0)
    OLLAMA_REQUEST_TIMEOUT: float = Field(default=300.0, gt=0)
    # Task prefixes recommended by nomic-embed-text. Leave unset to apply them
    # automatically for "nomic" models; set to "" to disable.
    EMBED_DOCUMENT_PREFIX: Optional[str] = None
    EMBED_QUERY_PREFIX: Optional[str] = None

    # ── Storage ─────────────────────────────────────────────────────────────
    CHROMA_PERSIST_DIR: str = "./chroma_db"
    CHROMA_COLLECTION: str = "rag_sentences"
    # Original uploaded files + per-page text used by the document viewer.
    DOCUMENT_STORE_DIR: str = "./document_store"

    # ── Sentence segmentation ───────────────────────────────────────────────
    # Sentences longer than this are split further on ; : , or whitespace.
    MAX_SENTENCE_CHARS: int = Field(default=600, ge=80)
    # TXT/DOCX have no real pages; they are split into virtual pages of this size.
    TEXT_PAGE_CHARS: int = Field(default=4000, ge=500)

    # ── Retrieval / evidence ────────────────────────────────────────────────
    RETRIEVAL_TOP_K: int = Field(default=8, gt=0)
    # Neighbouring sentences added around each hit (each keeps its own snippet ID).
    EVIDENCE_WINDOW: int = Field(default=1, ge=0, le=5)
    MAX_CHAT_HISTORY: int = Field(default=6, ge=0)

    # ── API limits ──────────────────────────────────────────────────────────
    MAX_UPLOAD_SIZE_MB: int = Field(default=50, gt=0)
    MAX_QUERY_LENGTH: int = Field(default=4000, gt=0)

    # ── HTTP ────────────────────────────────────────────────────────────────
    # Comma-separated list of allowed CORS origins.
    CORS_ORIGINS: str = "http://localhost:5173,http://127.0.0.1:5173"
    # Base URL of the frontend, used to build absolute highlight deep links.
    FRONTEND_URL: str = "http://localhost:5173"

    @property
    def cors_origins_list(self) -> List[str]:
        """Return CORS origins as a cleaned list."""
        return [origin.strip() for origin in self.CORS_ORIGINS.split(",") if origin.strip()]

    @property
    def max_upload_size_bytes(self) -> int:
        """Return the maximum upload size in bytes."""
        return self.MAX_UPLOAD_SIZE_MB * 1024 * 1024

    @property
    def embed_document_prefix(self) -> str:
        """Return the prefix prepended to every embedded sentence."""
        if self.EMBED_DOCUMENT_PREFIX is not None:
            return self.EMBED_DOCUMENT_PREFIX
        return "search_document: " if "nomic" in self.OLLAMA_EMBED_MODEL.lower() else ""

    @property
    def embed_query_prefix(self) -> str:
        """Return the prefix prepended to every embedded query."""
        if self.EMBED_QUERY_PREFIX is not None:
            return self.EMBED_QUERY_PREFIX
        return "search_query: " if "nomic" in self.OLLAMA_EMBED_MODEL.lower() else ""


@lru_cache
def get_settings() -> Settings:
    """Return the cached application settings (FastAPI dependency)."""
    return Settings()
