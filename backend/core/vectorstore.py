"""ChromaDB vector store of sentence embeddings (local, persistent).

Each record is one sentence. Its metadata (``doc_id``, ``source``,
``sentence_index``, ``page``, ``start``, ``end``) links it back to the
document store, where the page text and highlight rectangles live.
"""

import logging
from functools import lru_cache
from pathlib import Path
from typing import Any, Dict, List, Optional

import chromadb
from chromadb.config import Settings as ChromaClientSettings
from langchain_chroma import Chroma
from langchain_core.documents import Document
from langchain_core.embeddings import Embeddings

from config import Settings, get_settings
from core.chunker import Sentence
from core.embedder import get_embeddings

logger = logging.getLogger(__name__)

# Number of sentences embedded and written per request to Ollama/Chroma.
_ADD_BATCH_SIZE = 128


class VectorStore:
    """CRUD and similarity search over a persistent ChromaDB collection."""

    def __init__(self, settings: Settings, embeddings: Embeddings) -> None:
        """Open (or create) the persistent Chroma collection.

        Args:
            settings: Application settings (persist dir + collection name).
            embeddings: Embedding function used for sentences and queries.
        """
        self._settings = settings
        self._embeddings = embeddings
        Path(settings.CHROMA_PERSIST_DIR).mkdir(parents=True, exist_ok=True)
        self._client = chromadb.PersistentClient(
            path=settings.CHROMA_PERSIST_DIR,
            settings=ChromaClientSettings(anonymized_telemetry=False),
        )
        self._store = Chroma(
            client=self._client,
            collection_name=settings.CHROMA_COLLECTION,
            embedding_function=embeddings,
            collection_metadata={"hnsw:space": "cosine"},
        )

    @property
    def _collection(self) -> Any:
        """Return the underlying chromadb collection."""
        return self._client.get_or_create_collection(self._settings.CHROMA_COLLECTION)

    def embed_sentences(self, sentences: List[Sentence]) -> List[List[float]]:
        """Embed sentence texts in batches (the slow, failure-prone step)."""
        vectors: List[List[float]] = []
        for start in range(0, len(sentences), _ADD_BATCH_SIZE):
            batch = sentences[start : start + _ADD_BATCH_SIZE]
            vectors.extend(self._embeddings.embed_documents([s.text for s in batch]))
        return vectors

    def replace_document(
        self, doc_id: str, filename: str, sentences: List[Sentence], vectors: List[List[float]]
    ) -> int:
        """Swap all stored sentences of ``doc_id`` for pre-computed ones.

        IDs are ``<doc_id>:<sentence_index>``, so they are stable and unique.

        Returns:
            Number of sentences stored.
        """
        if len(vectors) != len(sentences):
            raise ValueError("Each sentence needs exactly one embedding vector")
        self.delete_document(doc_id)
        for start in range(0, len(sentences), _ADD_BATCH_SIZE):
            batch = sentences[start : start + _ADD_BATCH_SIZE]
            self._collection.upsert(
                ids=[f"{doc_id}:{s.index}" for s in batch],
                embeddings=vectors[start : start + _ADD_BATCH_SIZE],
                documents=[s.text for s in batch],
                metadatas=[
                    {
                        "doc_id": doc_id,
                        "source": filename,
                        "sentence_index": s.index,
                        "page": s.page,
                        "start": s.start,
                        "end": s.end,
                    }
                    for s in batch
                ],
            )
        logger.info("Indexed %d sentences for '%s'", len(sentences), filename)
        return len(sentences)

    def add_sentences(self, doc_id: str, filename: str, sentences: List[Sentence]) -> int:
        """Embed and store a document's sentences, replacing any previous version.

        Returns:
            Number of sentences added.
        """
        if not sentences:
            return 0
        return self.replace_document(doc_id, filename, sentences, self.embed_sentences(sentences))

    def search(self, query: str, k: Optional[int] = None) -> List[Document]:
        """Return the ``k`` sentences most similar to ``query``.

        The relevance (0–1, higher is better) is stored in ``metadata["score"]``.
        """
        k = k or self._settings.RETRIEVAL_TOP_K
        if self.count() == 0:
            return []
        # Cosine distance is in [0, 2]; map it to a clamped [0, 1] relevance score.
        results = self._store.similarity_search_with_score(query, k=k)
        documents: List[Document] = []
        for doc, distance in results:
            doc.metadata["score"] = round(max(0.0, min(1.0, 1.0 - float(distance))), 4)
            documents.append(doc)
        return documents

    def count(self) -> int:
        """Return the total number of sentences in the collection."""
        return int(self._collection.count())

    def count_for(self, doc_id: str) -> int:
        """Return how many sentences of ``doc_id`` are indexed."""
        data = self._collection.get(where={"doc_id": doc_id}, include=[])
        return len(data.get("ids") or [])

    def has_document(self, doc_id: str) -> bool:
        """Return True if any sentence of ``doc_id`` is stored."""
        data = self._collection.get(where={"doc_id": doc_id}, limit=1, include=[])
        return bool(data.get("ids"))

    def delete_document(self, doc_id: str) -> int:
        """Delete every sentence of ``doc_id``.

        Returns:
            Number of sentences deleted.
        """
        data = self._collection.get(where={"doc_id": doc_id}, include=[])
        ids = data.get("ids") or []
        if ids:
            self._collection.delete(ids=ids)
        logger.info("Deleted %d sentences for doc %s", len(ids), doc_id)
        return len(ids)

    def get_stats(self) -> Dict[str, Any]:
        """Return collection statistics."""
        return {
            "collection": self._settings.CHROMA_COLLECTION,
            "persist_dir": self._settings.CHROMA_PERSIST_DIR,
            "total_sentences": self.count(),
        }

    def heartbeat(self) -> bool:
        """Return True if ChromaDB is reachable and the collection is readable."""
        try:
            self._client.heartbeat()
            self._collection.count()
            return True
        except Exception as exc:  # noqa: BLE001
            logger.warning("ChromaDB heartbeat failed: %s", exc)
            return False


@lru_cache(maxsize=1)
def get_vector_store() -> VectorStore:
    """Return the singleton VectorStore (FastAPI dependency)."""
    return VectorStore(settings=get_settings(), embeddings=get_embeddings())
