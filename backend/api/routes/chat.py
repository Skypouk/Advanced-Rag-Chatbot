"""POST /api/chat – sentence-level RAG answer streamed as Server-Sent Events.

Pipeline: embed query → retrieve the most similar sentences → expand them with
neighbours → prompt the LLM with ID-labelled snippets → stream the answer →
resolve the cited snippet IDs.
"""

import json
import logging
from typing import Any, Generator, List, Literal

import httpx
import ollama
from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field, field_validator

from config import Settings, get_settings
from core.document_store import DocumentStore, get_document_store
from core.evidence import build_evidence, extract_citations
from core.llm import LLMService, get_llm_service
from core.vectorstore import VectorStore, get_vector_store

logger = logging.getLogger(__name__)

router = APIRouter(tags=["chat"])

NO_DOCUMENTS_MESSAGE = (
    "There are no documents in the knowledge base yet. "
    "Please upload a PDF, DOCX or TXT file using the sidebar, then ask your question again."
)
NO_RESULTS_MESSAGE = "I couldn't find anything relevant to your question in the uploaded documents."


class ChatHistoryMessage(BaseModel):
    """A previous turn of the conversation."""

    role: Literal["user", "assistant"]
    content: str


class ChatRequest(BaseModel):
    """Request body for the chat endpoint."""

    query: str = Field(..., description="The user's question")
    chat_history: List[ChatHistoryMessage] = Field(default_factory=list)

    @field_validator("query")
    @classmethod
    def _validate_query(cls, value: str) -> str:
        """Reject blank queries and enforce the configured max length."""
        value = value.strip()
        if not value:
            raise ValueError("Query must not be empty.")
        max_len = get_settings().MAX_QUERY_LENGTH
        if len(value) > max_len:
            raise ValueError(f"Query is too long (max {max_len} characters).")
        return value


def _sse(event_type: str, content: Any) -> str:
    """Serialize one SSE ``data:`` event."""
    return f"data: {json.dumps({'type': event_type, 'content': content}, ensure_ascii=False)}\n\n"


def _friendly_error(exc: Exception, settings: Settings) -> str:
    """Map backend exceptions to a user-facing error message."""
    if isinstance(exc, (ConnectionError, httpx.ConnectError, httpx.TimeoutException)):
        return f"Could not reach Ollama at {settings.OLLAMA_BASE_URL}. Make sure it is running."
    if isinstance(exc, ollama.ResponseError):
        return f"The model returned an error: {exc.error}"
    return f"Something went wrong while generating the answer: {exc}"


def _stream_answer(
    request: ChatRequest,
    vectors: VectorStore,
    documents: DocumentStore,
    llm: LLMService,
    settings: Settings,
) -> Generator[str, None, None]:
    """Yield SSE events: sources → tokens → citations → done (or error → done)."""
    try:
        if vectors.count() == 0:
            yield _sse("sources", [])
            yield _sse("token", NO_DOCUMENTS_MESSAGE)
            yield _sse("citations", [])
            yield _sse("done", "")
            return

        hits = vectors.search(request.query, k=settings.RETRIEVAL_TOP_K)
        snippets, groups = build_evidence(hits, documents, settings.EVIDENCE_WINDOW)
        yield _sse("sources", [s.to_payload(settings.FRONTEND_URL) for s in snippets])

        if not snippets:
            yield _sse("token", NO_RESULTS_MESSAGE)
            yield _sse("citations", [])
            yield _sse("done", "")
            return

        history = [message.model_dump() for message in request.chat_history]
        messages = llm.build_prompt(request.query, groups, history)

        answer_parts: List[str] = []
        for token in llm.generate_stream(messages):
            answer_parts.append(token)
            yield _sse("token", token)

        cited = extract_citations("".join(answer_parts), {s.id for s in snippets})
        yield _sse("citations", cited)
        yield _sse("done", "")
    except Exception as exc:  # noqa: BLE001 - errors must be reported in-stream
        logger.exception("Chat stream failed")
        yield _sse("error", _friendly_error(exc, settings))
        yield _sse("done", "")


@router.post("/chat")
def chat(
    request: ChatRequest,
    vectors: VectorStore = Depends(get_vector_store),
    documents: DocumentStore = Depends(get_document_store),
    llm: LLMService = Depends(get_llm_service),
    settings: Settings = Depends(get_settings),
) -> StreamingResponse:
    """Answer a question about the indexed documents as an SSE stream.

    Event payloads are JSON objects ``{"type", "content"}`` where ``type`` is
    one of ``sources`` (evidence snippets with page/offset/rect locations and
    deep links), ``token``, ``citations`` (snippet IDs cited in the answer),
    ``error`` or ``done``.
    """
    return StreamingResponse(
        _stream_answer(request, vectors, documents, llm, settings),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
