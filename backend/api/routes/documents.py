"""/api/documents – list, inspect, view and delete indexed documents."""

import logging
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Response, status
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import FileResponse
from pydantic import BaseModel

from core.document_store import DocumentStore, get_document_store
from core.vectorstore import VectorStore, get_vector_store

logger = logging.getLogger(__name__)

router = APIRouter(tags=["documents"])

_MEDIA_TYPES = {
    "pdf": "application/pdf",
    "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "txt": "text/plain; charset=utf-8",
}


class DocumentInfo(BaseModel):
    """An indexed document."""

    filename: str
    chunk_count: int  # number of indexed sentences
    doc_id: str
    file_type: str
    page_count: int
    version: str


class DocumentsResponse(BaseModel):
    """Response body for the document listing."""

    documents: List[DocumentInfo]


class DeleteResponse(BaseModel):
    """Response body for a document deletion."""

    status: str
    message: str


class PageInfo(BaseModel):
    """One page of a document's extracted text."""

    number: int
    text: str
    width: Optional[float] = None
    height: Optional[float] = None


class PageSentence(BaseModel):
    """A sentence located on a page."""

    index: int
    start: int
    end: int
    rects: List[List[float]]


class PageResponse(BaseModel):
    """A page plus the document metadata the viewer needs."""

    doc_id: str
    filename: str
    file_type: str
    page_count: int
    version: str
    page: PageInfo
    sentences: List[PageSentence]


def _info(meta: dict) -> DocumentInfo:
    """Build a DocumentInfo from stored metadata."""
    return DocumentInfo(
        filename=meta["filename"],
        chunk_count=meta["sentence_count"],
        doc_id=meta["doc_id"],
        file_type=meta["file_type"],
        page_count=meta["page_count"],
        version=meta["created_at"],
    )


def _require_meta(store: DocumentStore, doc_id: str) -> dict:
    """Return a document's metadata or raise 404."""
    meta = store.get_meta(doc_id) if store.is_valid_id(doc_id) else None
    if meta is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found.")
    return meta


@router.get("/documents", response_model=DocumentsResponse)
async def list_documents(store: DocumentStore = Depends(get_document_store)) -> DocumentsResponse:
    """List every indexed document."""
    try:
        metas = await run_in_threadpool(store.list)
    except Exception as exc:  # noqa: BLE001
        logger.exception("Failed to list documents")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=f"Could not read the document store: {exc}"
        ) from exc
    return DocumentsResponse(documents=[_info(meta) for meta in metas])


@router.get("/documents/{doc_id}/file")
async def get_document_file(doc_id: str, store: DocumentStore = Depends(get_document_store)) -> Response:
    """Serve the original uploaded file (displayed inline by the viewer)."""
    meta = _require_meta(store, doc_id)
    path = store.original_path(doc_id)
    if path is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Original file is missing.")
    return FileResponse(
        path,
        media_type=_MEDIA_TYPES.get(meta["file_type"], "application/octet-stream"),
        filename=meta["filename"],
        content_disposition_type="inline",
    )


@router.get("/documents/{doc_id}/pages/{page_number}", response_model=PageResponse)
async def get_document_page(
    doc_id: str, page_number: int, store: DocumentStore = Depends(get_document_store)
) -> PageResponse:
    """Return one page's text and located sentences (for highlighting)."""
    meta = _require_meta(store, doc_id)
    try:
        content = await run_in_threadpool(store.get_content, doc_id)
    except Exception as exc:  # noqa: BLE001
        logger.exception("Failed to read document %s", doc_id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"Could not read the document: {exc}"
        ) from exc
    if content is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found.")

    page = next((p for p in content["pages"] if p["number"] == page_number), None)
    if page is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Page {page_number} does not exist (document has {meta['page_count']} pages).",
        )
    sentences = [
        PageSentence(index=s["index"], start=s["start"], end=s["end"], rects=s.get("rects") or [])
        for s in content["sentences"]
        if s["page"] == page_number
    ]
    return PageResponse(
        doc_id=doc_id,
        filename=meta["filename"],
        file_type=meta["file_type"],
        page_count=meta["page_count"],
        version=meta["created_at"],
        page=PageInfo(**page),
        sentences=sentences,
    )


@router.delete("/documents/{filename:path}", response_model=DeleteResponse)
async def delete_document(
    filename: str,
    vectors: VectorStore = Depends(get_vector_store),
    store: DocumentStore = Depends(get_document_store),
) -> DeleteResponse:
    """Delete a document's sentences, stored text and original file."""
    doc_id = DocumentStore.doc_id_for(filename)
    try:
        deleted = await run_in_threadpool(vectors.delete_document, doc_id)
        removed = await run_in_threadpool(store.delete, doc_id)
    except Exception as exc:  # noqa: BLE001
        logger.exception("Failed to delete '%s'", filename)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"Could not delete '{filename}': {exc}"
        ) from exc

    if deleted == 0 and not removed:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Document '{filename}' was not found.")

    return DeleteResponse(status="success", message=f"Deleted '{filename}' ({deleted} sentences).")
