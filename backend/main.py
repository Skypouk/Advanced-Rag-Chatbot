"""FastAPI application entry point.

Run locally with:  uvicorn main:app --reload --port 8000
"""

import logging

from fastapi import Depends, FastAPI, HTTPException, Request, status
from fastapi.concurrency import run_in_threadpool
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from starlette.exceptions import HTTPException as StarletteHTTPException

from api.routes import chat, documents, upload
from config import get_settings
from core.llm import LLMService, get_llm_service
from core.vectorstore import get_vector_store

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s [%(name)s] %(message)s")
logger = logging.getLogger("rag-chatbot")

settings = get_settings()

app = FastAPI(
    title="RAG Chatbot API",
    description="Local retrieval-augmented chatbot powered by Ollama, LangChain and ChromaDB.",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Consistent error format: { "detail": string } ──────────────────────────


@app.exception_handler(StarletteHTTPException)
async def http_exception_handler(_: Request, exc: StarletteHTTPException) -> JSONResponse:
    """Return HTTP errors as ``{"detail": str}``."""
    detail = exc.detail if isinstance(exc.detail, str) else str(exc.detail)
    return JSONResponse(status_code=exc.status_code, content={"detail": detail}, headers=exc.headers)


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(_: Request, exc: RequestValidationError) -> JSONResponse:
    """Flatten Pydantic validation errors into a single readable string."""
    messages = []
    for error in exc.errors():
        location = ".".join(str(part) for part in error.get("loc", ()) if part not in ("body", "query", "path"))
        message = str(error.get("msg", "Invalid value")).removeprefix("Value error, ")
        messages.append(f"{location}: {message}" if location else message)
    return JSONResponse(
        status_code=422,
        content={"detail": "; ".join(messages) or "Invalid request."},
    )


@app.exception_handler(Exception)
async def unhandled_exception_handler(_: Request, exc: Exception) -> JSONResponse:
    """Catch-all so unexpected errors still use the standard error format."""
    logger.exception("Unhandled error: %s", exc)
    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content={"detail": "Internal server error. Check the backend logs for details."},
    )


# ── Routers ────────────────────────────────────────────────────────────────

app.include_router(upload.router, prefix="/api")
app.include_router(chat.router, prefix="/api")
app.include_router(documents.router, prefix="/api")


# ── Health ─────────────────────────────────────────────────────────────────


class HealthResponse(BaseModel):
    """Health status of the backend and its dependencies."""

    status: str
    ollama: bool
    chromadb: bool


def _chroma_healthy() -> bool:
    """Return True if the vector store can be opened and queried."""
    try:
        return get_vector_store().heartbeat()
    except Exception as exc:  # noqa: BLE001
        logger.warning("ChromaDB unavailable: %s", exc)
        return False


@app.get("/api/health", response_model=HealthResponse, tags=["health"])
async def health(llm: LLMService = Depends(get_llm_service)) -> HealthResponse:
    """Report connectivity to Ollama and ChromaDB.

    ``status`` is ``"ok"`` when both are reachable, otherwise ``"degraded"``.
    """
    try:
        ollama_ok = await run_in_threadpool(llm.ping)
        chroma_ok = await run_in_threadpool(_chroma_healthy)
    except Exception as exc:  # noqa: BLE001
        logger.exception("Health check failed")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(exc)) from exc
    return HealthResponse(
        status="ok" if ollama_ok and chroma_ok else "degraded",
        ollama=ollama_ok,
        chromadb=chroma_ok,
    )


@app.get("/", include_in_schema=False)
async def root() -> dict:
    """Small landing response pointing to the API docs."""
    return {"name": "RAG Chatbot API", "docs": "/docs", "health": "/api/health"}
