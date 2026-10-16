"""Sentence segmentation with exact character offsets.

Each page is split into sentences on terminal punctuation (. ! ? … and the
CJK equivalents) and on paragraph breaks. Every sentence keeps its
``[start, end)`` offsets in the page text and, for PDFs, the rectangles that
cover it on the page. That is what makes exact highlighting possible.
"""

import re
from bisect import bisect_right
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple

from langchain_text_splitters import RecursiveCharacterTextSplitter

from config import Settings, get_settings
from core.extractor import ExtractedDocument, ExtractedPage

# Terminal punctuation, optionally followed by closing quotes/brackets, that is
# followed by whitespace or the end of the paragraph. CJK terminators need no space.
_TERMINATOR = re.compile(r"[.!?…]+[\"'”’»)\]]*(?=\s|$)|[。！？]+")
_PARAGRAPH_BREAK = re.compile(r"\n\s*\n")

# Lower-cased tokens (without the final period) that do not end a sentence.
_ABBREVIATIONS = {
    "mr", "mrs", "ms", "dr", "prof", "sr", "jr", "st", "mt", "vs", "etc", "e.g", "i.e", "cf", "al",
    "fig", "figs", "eq", "eqs", "no", "nos", "vol", "vols", "p", "pp", "ch", "sec", "art", "approx",
    "inc", "ltd", "co", "corp", "dept", "est", "jan", "feb", "mar", "apr", "jun", "jul", "aug",
    "sep", "sept", "oct", "nov", "dec", "u.s", "u.k", "a.m", "p.m", "ph.d", "resp", "incl", "min", "max",
}

Rect = List[float]


@dataclass
class Sentence:
    """A sentence located in a document."""

    index: int  # position in the document, 0-based
    page: int  # 1-based page number
    start: int  # offset in the page text (inclusive)
    end: int  # offset in the page text (exclusive)
    text: str  # whitespace-normalized sentence text
    rects: List[Rect] = field(default_factory=list)  # PDF points, top-left origin


def _is_sentence_boundary(text: str, match: re.Match, paragraph_end: int) -> bool:
    """Decide whether a punctuation match really ends a sentence."""
    punctuation = match.group()
    if punctuation[0] in "。！？":
        return True

    if punctuation.startswith(".") and not punctuation.startswith(".."):
        word_start = match.start()
        while word_start > 0 and not text[word_start - 1].isspace():
            word_start -= 1
        token = text[word_start : match.start()].lstrip("(\"'“‘[").lower()
        if token in _ABBREVIATIONS:
            return False
        if len(token) == 1 and token.isalpha():  # initials such as "J. Smith"
            return False
        if "." in token and len(token) <= 6 and token.replace(".", "").isalpha():  # "U.S.", "e.g."
            return False

    # A sentence never continues with a lower-case letter.
    position = match.end()
    while position < paragraph_end and text[position].isspace():
        position += 1
    if position >= paragraph_end:
        return True
    return not text[position].islower()


def _trim(text: str, start: int, end: int) -> Tuple[int, int]:
    """Shrink ``[start, end)`` so it excludes surrounding whitespace."""
    while start < end and text[start].isspace():
        start += 1
    while end > start and text[end - 1].isspace():
        end -= 1
    return start, end


def _split_long(text: str, start: int, end: int, max_chars: int) -> List[Tuple[int, int]]:
    """Split an over-long sentence on ; : , or whitespace, preserving offsets."""
    splitter = RecursiveCharacterTextSplitter(
        chunk_size=max_chars,
        chunk_overlap=0,
        separators=["; ", ": ", ", ", " ", ""],
        keep_separator="end",
        add_start_index=True,
    )
    pieces = []
    for doc in splitter.create_documents([text[start:end]]):
        piece_start = start + int(doc.metadata["start_index"])
        pieces.append(_trim(text, piece_start, piece_start + len(doc.page_content)))
    return pieces


def split_sentences(text: str, max_chars: int = 600) -> List[Tuple[int, int]]:
    """Split text into sentences and return their ``(start, end)`` offsets.

    Args:
        text: Text to split.
        max_chars: Sentences longer than this are split further.

    Returns:
        Offsets of each sentence, in order. Fragments without any letter
        (page numbers, bullets) are dropped.
    """
    offsets: List[Tuple[int, int]] = []

    def emit(start: int, end: int) -> None:
        start, end = _trim(text, start, end)
        if not any(ch.isalpha() for ch in text[start:end]):
            return
        if end - start > max_chars:
            offsets.extend(_split_long(text, start, end, max_chars))
        else:
            offsets.append((start, end))

    paragraph_start = 0
    boundaries = [m.start() for m in _PARAGRAPH_BREAK.finditer(text)] + [len(text)]
    for paragraph_end in boundaries:
        sentence_start = paragraph_start
        for match in _TERMINATOR.finditer(text, paragraph_start, paragraph_end):
            if _is_sentence_boundary(text, match, paragraph_end):
                emit(sentence_start, match.end())
                sentence_start = match.end()
        emit(sentence_start, paragraph_end)
        paragraph_start = paragraph_end
    return offsets


def _sentence_rects(page: ExtractedPage, span_ends: List[int], start: int, end: int) -> List[Rect]:
    """Return one rectangle per line covered by ``[start, end)`` on a PDF page."""
    rects: Dict[str, List[float]] = {}
    i = bisect_right(span_ends, start)
    while i < len(page.spans) and page.spans[i].start < end:
        span = page.spans[i]
        x0, y0, x1, y1 = span.rect
        if span.line in rects:
            r = rects[span.line]
            rects[span.line] = [min(r[0], x0), min(r[1], y0), max(r[2], x1), max(r[3], y1)]
        else:
            rects[span.line] = [x0, y0, x1, y1]
        i += 1
    return [[round(v, 2) for v in r] for r in rects.values()]


def segment_document(document: ExtractedDocument, settings: Optional[Settings] = None) -> List[Sentence]:
    """Split every page of a document into located sentences.

    Args:
        document: The extracted document.
        settings: Optional settings override.

    Returns:
        Sentences in reading order with page, offsets and highlight rectangles.
    """
    settings = settings or get_settings()
    sentences: List[Sentence] = []
    for page in document.pages:
        span_ends = [span.end for span in page.spans]
        for start, end in split_sentences(page.text, settings.MAX_SENTENCE_CHARS):
            sentences.append(
                Sentence(
                    index=len(sentences),
                    page=page.number,
                    start=start,
                    end=end,
                    text=" ".join(page.text[start:end].split()),
                    rects=_sentence_rects(page, span_ends, start, end) if page.spans else [],
                )
            )
    return sentences
