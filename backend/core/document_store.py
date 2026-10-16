"""On-disk store for original files, page text and located sentences.

Layout (one directory per document)::

    DOCUMENT_STORE_DIR/<doc_id>/
        original.<ext>   the uploaded file (served to the PDF viewer)
        meta.json        filename, type, page/sentence counts
        content.json     pages (text + size) and sentences (offsets + rects)

The vector store only holds sentence embeddings; this store is the source of
truth that maps a sentence back to its page, offsets and highlight boxes.
"""

import hashlib
import json
import logging
import re
import shutil
import threading
import uuid
from dataclasses import asdict
from datetime import datetime, timezone
from functools import lru_cache
from pathlib import Path
from typing import Any, Dict, List, Optional

from config import get_settings
from core.chunker import Sentence
from core.extractor import ExtractedDocument

logger = logging.getLogger(__name__)

_DOC_ID_PATTERN = re.compile(r"^[0-9a-f]{16}$")


class DocumentStore:
    """Persist and load documents by a stable ``doc_id``."""

    def __init__(self, root: str | Path) -> None:
        """Create the store rooted at ``root``."""
        self._root = Path(root)
        self._root.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()
        self._content_cache: Dict[str, tuple[int, Dict[str, Any]]] = {}

    @staticmethod
    def doc_id_for(filename: str) -> str:
        """Return the stable id of a filename (filenames are unique)."""
        return hashlib.sha1(filename.encode("utf-8")).hexdigest()[:16]

    @staticmethod
    def is_valid_id(doc_id: str) -> bool:
        """Return True if ``doc_id`` has the expected format."""
        return bool(_DOC_ID_PATTERN.match(doc_id))

    def _dir(self, doc_id: str) -> Path:
        """Return the directory of a document, rejecting malformed ids."""
        if not self.is_valid_id(doc_id):
            raise ValueError(f"Invalid document id '{doc_id}'")
        return self._root / doc_id

    def exists(self, doc_id: str) -> bool:
        """Return True if the document is stored."""
        return self.is_valid_id(doc_id) and (self._dir(doc_id) / "meta.json").is_file()

    def save(
        self,
        doc_id: str,
        filename: str,
        document: ExtractedDocument,
        sentences: List[Sentence],
        original: Path,
    ) -> Dict[str, Any]:
        """Write (or atomically replace) a document.

        Returns:
            The document's metadata.
        """
        meta = {
            "doc_id": doc_id,
            "filename": filename,
            "file_type": document.file_type,
            "extractor": document.extractor,
            "page_count": len(document.pages),
            "sentence_count": len(sentences),
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
        content = {
            "pages": [
                {"number": p.number, "text": p.text, "width": p.width, "height": p.height}
                for p in document.pages
            ],
            "sentences": [asdict(s) for s in sentences],
        }

        target = self._dir(doc_id)
        self._root.mkdir(parents=True, exist_ok=True)  # recreate if removed at runtime
        staging = self._root / f".staging-{doc_id}-{uuid.uuid4().hex[:8]}"
        staging.mkdir()
        try:
            shutil.copyfile(original, staging / f"original.{document.file_type}")
            (staging / "content.json").write_text(json.dumps(content, ensure_ascii=False), encoding="utf-8")
            (staging / "meta.json").write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")
            with self._lock:
                if target.exists():
                    retired = self._root / f".retired-{doc_id}-{uuid.uuid4().hex[:8]}"
                    target.rename(retired)
                    shutil.rmtree(retired, ignore_errors=True)
                staging.rename(target)
                self._content_cache.pop(doc_id, None)
        except BaseException:
            shutil.rmtree(staging, ignore_errors=True)
            raise
        return meta

    def delete(self, doc_id: str) -> bool:
        """Delete a document; returns False if it did not exist."""
        if not self.exists(doc_id):
            return False
        with self._lock:
            shutil.rmtree(self._dir(doc_id), ignore_errors=True)
            self._content_cache.pop(doc_id, None)
        return True

    def get_meta(self, doc_id: str) -> Optional[Dict[str, Any]]:
        """Return a document's metadata, or None if it does not exist."""
        if not self.exists(doc_id):
            return None
        return json.loads((self._dir(doc_id) / "meta.json").read_text(encoding="utf-8"))

    def get_content(self, doc_id: str) -> Optional[Dict[str, Any]]:
        """Return a document's pages and sentences (cached by file mtime)."""
        if not self.exists(doc_id):
            return None
        path = self._dir(doc_id) / "content.json"
        mtime = path.stat().st_mtime_ns
        cached = self._content_cache.get(doc_id)
        if cached and cached[0] == mtime:
            return cached[1]
        content = json.loads(path.read_text(encoding="utf-8"))
        self._content_cache[doc_id] = (mtime, content)
        return content

    def original_path(self, doc_id: str) -> Optional[Path]:
        """Return the path of the original uploaded file."""
        meta = self.get_meta(doc_id)
        if meta is None:
            return None
        path = self._dir(doc_id) / f"original.{meta['file_type']}"
        return path if path.is_file() else None

    def list(self) -> List[Dict[str, Any]]:
        """Return metadata of all stored documents, sorted by filename."""
        if not self._root.is_dir():
            return []
        metas = []
        for child in self._root.iterdir():
            if child.is_dir() and self.is_valid_id(child.name):
                meta = self.get_meta(child.name)
                if meta:
                    metas.append(meta)
        return sorted(metas, key=lambda m: m["filename"].lower())


@lru_cache(maxsize=1)
def get_document_store() -> DocumentStore:
    """Return the singleton DocumentStore (FastAPI dependency)."""
    return DocumentStore(get_settings().DOCUMENT_STORE_DIR)
