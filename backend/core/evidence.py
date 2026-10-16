"""Evidence assembly and citation mapping.

1. **Retrieve**: the most similar sentences come from the vector store.
2. **Expand**: each hit is widened with its neighbouring sentences
   (``EVIDENCE_WINDOW``). Every sentence keeps its own snippet ID, so a
   citation always points at one exact sentence.
3. **Label**: snippets get short, prompt-friendly IDs (``S1``, ``S2``, ...).
4. **Map**: after generation, the cited IDs are resolved back to
   document / page / character offsets / highlight rectangles, and a deep link.
"""

import re
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Sequence, Set, Tuple
from urllib.parse import urlencode

from langchain_core.documents import Document

from core.document_store import DocumentStore

# Matches citation groups such as [S1], [S1, S3] or [S2; S4] in model output.
CITATION_GROUP = re.compile(r"\[\s*S\d+(?:\s*[,;]\s*S?\d+)*\s*\]", re.IGNORECASE)
_CITATION_ID = re.compile(r"S?(\d+)", re.IGNORECASE)


@dataclass
class Snippet:
    """One sentence of evidence shown to the LLM and cited in the answer."""

    id: str  # "S1", "S2", ...
    doc_id: str
    filename: str
    file_type: str
    sentence_index: int
    page: int
    start: int
    end: int
    text: str
    rects: List[List[float]] = field(default_factory=list)
    page_width: Optional[float] = None
    page_height: Optional[float] = None
    score: Optional[float] = None  # similarity for direct hits, None for context sentences
    is_hit: bool = False

    def deep_link(self, frontend_url: str = "") -> str:
        """Return a link that opens the viewer with this snippet highlighted."""
        query = urlencode({"doc": self.doc_id, "page": self.page, "hl": f"{self.start}-{self.end}"})
        return f"{frontend_url.rstrip('/')}/?{query}#{self.id}"

    def to_payload(self, frontend_url: str = "") -> Dict[str, object]:
        """Serialize the snippet for the SSE ``sources`` event."""
        return {
            "id": self.id,
            "doc_id": self.doc_id,
            "filename": self.filename,
            "file_type": self.file_type,
            "page": self.page,
            "sentence_index": self.sentence_index,
            "start": self.start,
            "end": self.end,
            "text": self.text,
            "rects": self.rects,
            "page_width": self.page_width,
            "page_height": self.page_height,
            "score": self.score,
            "is_hit": self.is_hit,
            "link": self.deep_link(frontend_url),
        }


@dataclass
class EvidenceGroup:
    """A run of consecutive sentences from one document page range."""

    filename: str
    snippets: List[Snippet]


def build_evidence(
    hits: Sequence[Document],
    store: DocumentStore,
    window: int,
) -> Tuple[List[Snippet], List[EvidenceGroup]]:
    """Expand retrieved sentences with neighbours and assign snippet IDs.

    Args:
        hits: Sentences returned by the vector store (best first).
        store: Document store used to look up neighbouring sentences.
        window: Number of neighbours to add on each side of every hit.

    Returns:
        ``(snippets, groups)``. Snippets are numbered in reading order within
        each document; documents are ordered by their best hit. Groups are
        runs of consecutive sentences, used to format the prompt.
    """
    # Best score per (doc_id, sentence_index), keeping the document order of first appearance.
    hit_scores: Dict[Tuple[str, int], float] = {}
    doc_order: List[str] = []
    for doc in hits:
        meta = doc.metadata
        doc_id = str(meta.get("doc_id", ""))
        if not doc_id:
            continue
        key = (doc_id, int(meta.get("sentence_index", -1)))
        score = float(meta.get("score") or 0.0)
        hit_scores[key] = max(score, hit_scores.get(key, 0.0))
        if doc_id not in doc_order:
            doc_order.append(doc_id)

    snippets: List[Snippet] = []
    groups: List[EvidenceGroup] = []
    for doc_id in doc_order:
        meta = store.get_meta(doc_id)
        content = store.get_content(doc_id)
        if not meta or not content:
            continue  # vector store entry without stored document (stale)
        sentences = content["sentences"]
        pages = {p["number"]: p for p in content["pages"]}

        selected: Set[int] = set()
        for (hit_doc, index), _ in hit_scores.items():
            if hit_doc != doc_id or not 0 <= index < len(sentences):
                continue
            selected.update(range(max(0, index - window), min(len(sentences), index + window + 1)))

        previous: Optional[int] = None
        for index in sorted(selected):
            sentence = sentences[index]
            page = pages.get(sentence["page"], {})
            score = hit_scores.get((doc_id, index))
            snippet = Snippet(
                id=f"S{len(snippets) + 1}",
                doc_id=doc_id,
                filename=meta["filename"],
                file_type=meta["file_type"],
                sentence_index=index,
                page=sentence["page"],
                start=sentence["start"],
                end=sentence["end"],
                text=sentence["text"],
                rects=sentence.get("rects") or [],
                page_width=page.get("width"),
                page_height=page.get("height"),
                score=score,
                is_hit=score is not None,
            )
            snippets.append(snippet)
            if previous is None or index != previous + 1:
                groups.append(EvidenceGroup(filename=meta["filename"], snippets=[]))
            groups[-1].snippets.append(snippet)
            previous = index
    return snippets, groups


def extract_citations(answer: str, valid_ids: Set[str]) -> List[str]:
    """Return the snippet IDs cited in ``answer``, in order of first citation.

    Accepts ``[S1]``, ``[S1, S3]`` and ``[S1; 3]``. Unknown IDs are ignored.
    """
    cited: List[str] = []
    for group in CITATION_GROUP.finditer(answer):
        for number in _CITATION_ID.findall(group.group()[1:-1]):
            snippet_id = f"S{int(number)}"
            if snippet_id in valid_ids and snippet_id not in cited:
                cited.append(snippet_id)
    return cited
