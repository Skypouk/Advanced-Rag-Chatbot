"""POST /api/upload – ingest a document into the sentence index."""

import logging
import os
import tempfile
from pathlib import Path

import httpx
import ollama
from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel

from config import Settings, get_settings
from core.chunker import segment_document
from core.document_store import DocumentStore, get_document_store
from core.extractor import SUPPORTED_EXTENSIONS, ExtractionError, UnsupportedFileTypeError, extract_document
from core.vectorstore import VectorStore, get_vector_store

logger = logging.getLogger(__name__)

router = APIRouter(tags=["upload"])

_READ_CHUNK_BYTES = 1024 * 1024  # 1 MiB


class UploadResponse(BaseModel):
    """Response body returned after a successful upload."""

    filename: str
    doc_id: str
    chunks_indexed: int  # number of sentences indexed
    pages: int
    status: str
    message: str


def _sanitize_filename(raw_name: str | None) -> str:
    """Strip any directory components from a client-supplied filename."""
    name = Path((raw_name or "").replace("\\", "/")).name.strip()
    if not name:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="A filename is required.")
    return name


async def _save_upload_to_temp(file: UploadFile, suffix: str, max_bytes: int, max_mb: int) -> Path:
    """Stream the upload to a temporary file while enforcing the size limit.

    Returns:
        Path of the temporary file (caller must delete it).
    """
    size = 0
    fd, tmp_name = tempfile.mkstemp(suffix=suffix)
    tmp_path = Path(tmp_name)
    try:
        with os.fdopen(fd, "wb") as out:
            while chunk := await file.read(_READ_CHUNK_BYTES):
                size += len(chunk)
                if size > max_bytes:
                    raise HTTPException(
                        status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                        detail=f"File is too large. Maximum allowed size is {max_mb} MB.",
                    )
                out.write(chunk)
        if size == 0:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="The uploaded file is empty.")
        return tmp_path
    except BaseException:
        tmp_path.unlink(missing_ok=True)
        raise


def _ingest(
    tmp_path: Path,
    filename: str,
    doc_id: str,
    vectors: VectorStore,
    documents: DocumentStore,
    settings: Settings,
) -> tuple[int, int]:
    """Run the blocking extract → segment → embed → store pipeline.

    Embedding happens before anything is written, so a failure (e.g. Ollama
    down) leaves a previously indexed version of the document intact.

    Returns:
        ``(sentence_count, page_count)``.
    """
    document = extract_document(tmp_path, filename, settings)
    sentences = segment_document(document, settings)
    if not sentences:
        raise ExtractionError(f"No sentences could be extracted from '{filename}'.")
    embeddings = vectors.embed_sentences(sentences)
    documents.save(doc_id, filename, document, sentences, tmp_path)
    vectors.replace_document(doc_id, filename, sentences, embeddings)
    return len(sentences), len(document.pages)


@router.post("/upload", response_model=UploadResponse, status_code=status.HTTP_201_CREATED)
async def upload_document(
    file: UploadFile = File(..., description="PDF, DOCX or TXT document"),
    replace: bool = Query(False, description="Replace an existing document with the same filename"),
    vectors: VectorStore = Depends(get_vector_store),
    documents: DocumentStore = Depends(get_document_store),
    settings: Settings = Depends(get_settings),
) -> UploadResponse:
    """Upload a document, split it into sentences, embed and index each one."""
    filename = _sanitize_filename(file.filename)
    extension = Path(filename).suffix.lower()

    if extension not in SUPPORTED_EXTENSIONS:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail=f"Unsupported file type '{extension or 'unknown'}'. Allowed types: PDF, DOCX, TXT.",
        )

    doc_id = DocumentStore.doc_id_for(filename)
    try:
        already_indexed = documents.exists(doc_id) or await run_in_threadpool(vectors.has_document, doc_id)
    except Exception as exc:  # noqa: BLE001
        logger.exception("Vector store lookup failed")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=f"Vector store unavailable: {exc}"
        ) from exc

    if already_indexed and not replace:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"A document named '{filename}' is already indexed. Re-upload with replace=true to overwrite it.",
        )

    tmp_path = await _save_upload_to_temp(
        file, extension, settings.max_upload_size_bytes, settings.MAX_UPLOAD_SIZE_MB
    )
    try:
        sentence_count, page_count = await run_in_threadpool(
            _ingest, tmp_path, filename, doc_id, vectors, documents, settings
        )
    except UnsupportedFileTypeError as exc:
        raise HTTPException(status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, detail=str(exc)) from exc
    except ExtractionError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except (ConnectionError, httpx.ConnectError, httpx.TimeoutException) as exc:
        logger.exception("Embedding service unreachable")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"Could not reach Ollama at {settings.OLLAMA_BASE_URL}. Is it running?",
        ) from exc
    except ollama.ResponseError as exc:
        logger.exception("Embedding model error")
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Embedding failed ({exc.error}). Is the '{settings.OLLAMA_EMBED_MODEL}' model pulled?",
        ) from exc
    except Exception as exc:  # noqa: BLE001
        logger.exception("Unexpected error while indexing '%s'", filename)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"Failed to process '{filename}': {exc}"
        ) from exc
    finally:
        tmp_path.unlink(missing_ok=True)
        await file.close()

    action = "replaced" if already_indexed else "indexed"
    return UploadResponse(
        filename=filename,
        doc_id=doc_id,
        chunks_indexed=sentence_count,
        pages=page_count,
        status="success",
        message=f"'{filename}' {action} successfully ({sentence_count} sentences, {page_count} pages).",
    )
