"""Embedding model provider (nomic-embed-text served by Ollama)."""

from functools import lru_cache
from typing import List

from langchain_core.embeddings import Embeddings
from langchain_ollama import OllamaEmbeddings

from config import get_settings


class PrefixedEmbeddings(Embeddings):
    """Wrap an embedding model and add task prefixes to documents and queries.

    nomic-embed-text is trained with ``search_document:`` / ``search_query:``
    prefixes, which noticeably improve sentence-level retrieval.
    """

    def __init__(self, base: Embeddings, document_prefix: str, query_prefix: str) -> None:
        """Store the wrapped model and the prefixes."""
        self._base = base
        self._document_prefix = document_prefix
        self._query_prefix = query_prefix

    def embed_documents(self, texts: List[str]) -> List[List[float]]:
        """Embed sentences to be stored."""
        return self._base.embed_documents([self._document_prefix + text for text in texts])

    def embed_query(self, text: str) -> List[float]:
        """Embed a user question."""
        return self._base.embed_query(self._query_prefix + text)


@lru_cache(maxsize=1)
def get_embeddings() -> Embeddings:
    """Return the cached embedding model configured from settings."""
    settings = get_settings()
    return PrefixedEmbeddings(
        OllamaEmbeddings(model=settings.OLLAMA_EMBED_MODEL, base_url=settings.OLLAMA_BASE_URL),
        document_prefix=settings.embed_document_prefix,
        query_prefix=settings.embed_query_prefix,
    )
