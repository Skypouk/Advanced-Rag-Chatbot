/** Shared TypeScript types for the RAG chatbot frontend. */

/** Role of a chat participant. */
export type MessageRole = "user" | "assistant";

/** Supported document formats. */
export type FileType = "pdf" | "docx" | "txt";

/** A rectangle `[x0, y0, x1, y1]` in PDF points with a top-left origin. */
export type Rect = number[];

/**
 * One evidence sentence shown to the LLM, with everything needed to locate
 * and highlight it in the original document.
 */
export interface SourceDocument {
  /** Snippet ID cited by the LLM, e.g. "S3". */
  id: string;
  doc_id: string;
  filename: string;
  file_type: FileType;
  /** 1-based page (or text part for DOCX/TXT). */
  page: number;
  sentence_index: number;
  /** Character offsets of the sentence in the page text. */
  start: number;
  end: number;
  text: string;
  /** Highlight rectangles on the PDF page (empty for DOCX/TXT). */
  rects: Rect[];
  page_width?: number | null;
  page_height?: number | null;
  /** Similarity score for retrieved sentences; null for context neighbours. */
  score?: number | null;
  /** True if the sentence was retrieved directly (not added as context). */
  is_hit: boolean;
  /** Absolute deep link that opens the viewer with this sentence highlighted. */
  link: string;
}

/** A single chat message displayed in the conversation. */
export interface Message {
  id: string;
  role: MessageRole;
  content: string;
  /** Evidence snippets given to the LLM for this answer. */
  sources?: SourceDocument[];
  /** Snippet IDs the answer actually cites, in order of first citation. */
  citations?: string[];
  timestamp: number;
  isStreaming?: boolean;
  /** User-facing error message when generation failed. */
  error?: string;
}

/** An indexed document in the knowledge base. */
export interface Document {
  filename: string;
  /** Number of indexed sentences. */
  chunk_count: number;
  doc_id: string;
  file_type: FileType;
  page_count: number;
  /** Changes whenever the document is replaced (used for cache busting). */
  version: string;
}

/** Upload lifecycle state shown in the UI. */
export interface UploadStatus {
  status: "idle" | "uploading" | "success" | "error";
  message?: string;
  /** Upload progress in percent (0–100). 100 means the server is processing. */
  progress?: number;
}

/** Backend health status. */
export interface HealthStatus {
  status: string;
  ollama: boolean;
  chromadb: boolean;
}

/** Response returned by `POST /api/upload`. */
export interface UploadResponse {
  filename: string;
  doc_id: string;
  chunks_indexed: number;
  pages: number;
  status: string;
  message: string;
}

/** Response returned by `GET /api/documents`. */
export interface DocumentsResponse {
  documents: Document[];
}

/** Response returned by `DELETE /api/documents/{filename}`. */
export interface DeleteResponse {
  status: string;
  message: string;
}

/** A sentence located on a page, as returned by the page endpoint. */
export interface PageSentence {
  index: number;
  start: number;
  end: number;
  rects: Rect[];
}

/** Response returned by `GET /api/documents/{doc_id}/pages/{n}`. */
export interface PageResponse {
  doc_id: string;
  filename: string;
  file_type: FileType;
  page_count: number;
  version: string;
  page: {
    number: number;
    text: string;
    width?: number | null;
    height?: number | null;
  };
  sentences: PageSentence[];
}

/** Standard backend error body. */
export interface ApiErrorBody {
  detail: string;
}

/** Minimal chat turn sent to the backend as conversation history. */
export interface ChatHistoryItem {
  role: MessageRole;
  content: string;
}

/** A single Server-Sent Event emitted by `POST /api/chat`. */
export type StreamEvent =
  | { type: "token"; content: string }
  | { type: "sources"; content: SourceDocument[] }
  | { type: "citations"; content: string[] }
  | { type: "error"; content: string }
  | { type: "done"; content: string };

/** Handle returned by `streamChat`, similar to `EventSource.close()`. */
export interface ChatStreamHandle {
  close: () => void;
}

/** Result of an upload attempt from the `useDocuments` hook. */
export interface UploadResult {
  ok: boolean;
  /** True when the server rejected the upload because the filename exists. */
  duplicate?: boolean;
}

/** A range of page text to highlight in the document viewer. */
export interface Highlight {
  /** Snippet ID ("S3") or a synthetic id for deep links. */
  id: string;
  page: number;
  start: number;
  end: number;
  /** Cited by the answer (strong highlight) vs. evidence only (faint). */
  cited: boolean;
  text?: string;
}

/** What the document viewer should display. */
export interface ViewerTarget {
  docId: string;
  filename?: string;
  page: number;
  highlights: Highlight[];
  /** Highlight to scroll to and emphasize. */
  focusId?: string;
  /** Changes on every navigation so re-clicking the same citation re-scrolls. */
  nonce: number;
}

/** Visual state of a highlight in the viewer. */
export type HighlightKind = "active" | "cited" | "evidence";
