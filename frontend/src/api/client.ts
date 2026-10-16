import axios, { AxiosError } from "axios";

import { stripCitations } from "../lib/citations";
import type {
  ApiErrorBody,
  ChatHistoryItem,
  ChatStreamHandle,
  DeleteResponse,
  Document,
  DocumentsResponse,
  HealthStatus,
  Message,
  PageResponse,
  SourceDocument,
  StreamEvent,
  UploadResponse,
} from "../types";

/**
 * Base URL of the backend. Empty by default so requests are relative
 * (`/api/...`) and go through the Vite dev-server proxy.
 */
const API_BASE_URL: string = import.meta.env.VITE_API_BASE_URL ?? "";

const http = axios.create({
  baseURL: API_BASE_URL,
  timeout: 30_000,
});

/** Error raised by API helpers, carrying the HTTP status when available. */
export class ApiError extends Error {
  readonly status?: number;

  /**
   * @param message - User-facing error message.
   * @param status - HTTP status code, if the server responded.
   */
  constructor(message: string, status?: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

/** Type guard for the standard `{ detail: string }` backend error body. */
function isApiErrorBody(value: unknown): value is ApiErrorBody {
  return (
    typeof value === "object" &&
    value !== null &&
    "detail" in value &&
    typeof (value as { detail: unknown }).detail === "string"
  );
}

/**
 * Convert any thrown value into a readable, user-facing message.
 *
 * @param error - The caught error.
 * @returns A human-readable error message.
 */
export function getErrorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (axios.isAxiosError(error)) {
    const axiosError = error as AxiosError<unknown>;
    if (axiosError.response) {
      const data = axiosError.response.data;
      if (isApiErrorBody(data)) return data.detail;
      return `Request failed with status ${axiosError.response.status}.`;
    }
    if (axiosError.code === "ECONNABORTED") return "The request timed out. Please try again.";
    return "Cannot reach the server. Check that the backend is running.";
  }
  if (error instanceof Error) return error.message;
  return "An unexpected error occurred.";
}

/** Re-throw an Axios error as an `ApiError` with a clean message and status. */
function toApiError(error: unknown): ApiError {
  const status = axios.isAxiosError(error) ? error.response?.status : undefined;
  return new ApiError(getErrorMessage(error), status);
}

/**
 * Upload a document for indexing.
 *
 * @param file - The PDF, DOCX or TXT file to upload.
 * @param replace - Overwrite an existing document with the same filename.
 * @param onProgress - Optional callback receiving upload progress (0–100).
 * @returns The server's upload summary.
 * @throws {ApiError} With `status === 409` when the filename already exists.
 */
export async function uploadDocument(
  file: File,
  replace = false,
  onProgress?: (percent: number) => void,
): Promise<UploadResponse> {
  const form = new FormData();
  form.append("file", file);
  try {
    const { data } = await http.post<UploadResponse>("/api/upload", form, {
      params: { replace },
      timeout: 0, // extraction + embedding of large files can take minutes
      onUploadProgress: (event) => {
        if (onProgress && event.total) {
          onProgress(Math.round((event.loaded / event.total) * 100));
        }
      },
    });
    return data;
  } catch (error) {
    throw toApiError(error);
  }
}

/**
 * Fetch all indexed documents.
 *
 * @returns The list of documents with their chunk counts.
 */
export async function listDocuments(): Promise<Document[]> {
  try {
    const { data } = await http.get<DocumentsResponse>("/api/documents");
    return data.documents;
  } catch (error) {
    throw toApiError(error);
  }
}

/**
 * Delete a document and all its chunks.
 *
 * @param filename - Name of the document to delete.
 */
export async function deleteDocument(filename: string): Promise<void> {
  try {
    await http.delete<DeleteResponse>(`/api/documents/${encodeURIComponent(filename)}`);
  } catch (error) {
    throw toApiError(error);
  }
}

/**
 * Check backend, Ollama and ChromaDB health.
 *
 * @returns The current health status.
 */
export async function checkHealth(): Promise<HealthStatus> {
  try {
    const { data } = await http.get<HealthStatus>("/api/health", { timeout: 10_000 });
    return data;
  } catch (error) {
    throw toApiError(error);
  }
}

/**
 * URL of a document's original file (rendered by the PDF viewer).
 *
 * @param docId - Document id.
 * @param version - Document version, appended to bust caches after a replace.
 * @returns The file URL.
 */
export function documentFileUrl(docId: string, version?: string): string {
  const query = version ? `?v=${encodeURIComponent(version)}` : "";
  return `${API_BASE_URL}/api/documents/${encodeURIComponent(docId)}/file${query}`;
}

/**
 * Fetch one page of a document's extracted text and its located sentences.
 *
 * @param docId - Document id.
 * @param page - 1-based page number.
 * @param signal - Optional abort signal.
 * @returns The page data.
 */
export async function getDocumentPage(docId: string, page: number, signal?: AbortSignal): Promise<PageResponse> {
  try {
    const { data } = await http.get<PageResponse>(
      `/api/documents/${encodeURIComponent(docId)}/pages/${page}`,
      { signal },
    );
    return data;
  } catch (error) {
    throw toApiError(error);
  }
}

/** Type guard validating a parsed SSE payload. */
function isStreamEvent(value: unknown): value is StreamEvent {
  if (typeof value !== "object" || value === null) return false;
  const { type, content } = value as { type?: unknown; content?: unknown };
  switch (type) {
    case "token":
    case "error":
    case "done":
      return typeof content === "string";
    case "sources":
    case "citations":
      return Array.isArray(content);
    default:
      return false;
  }
}

/** Parse the `data:` lines of one SSE event block into a StreamEvent. */
function parseEventBlock(block: string): StreamEvent | null {
  const data = block
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).replace(/^ /, ""))
    .join("\n");
  if (!data) return null;
  try {
    const parsed: unknown = JSON.parse(data);
    return isStreamEvent(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Stream a RAG answer from `POST /api/chat` using Server-Sent Events.
 *
 * Uses `fetch` + `ReadableStream` because `EventSource` cannot send POST bodies.
 * Exactly one of `onDone` / `onError` is called at the end, unless the
 * stream is closed by the caller.
 *
 * @param query - The user's question.
 * @param history - Previous messages, used for multi-turn context.
 * @param onToken - Called for every generated text fragment.
 * @param onSources - Called once with the evidence snippets.
 * @param onDone - Called when the answer is complete.
 * @param onError - Called with a user-facing message on failure.
 * @param onCitations - Called once with the snippet IDs cited by the answer.
 * @returns A handle whose `close()` aborts the stream.
 */
export function streamChat(
  query: string,
  history: Message[],
  onToken: (token: string) => void,
  onSources: (sources: SourceDocument[]) => void,
  onDone: () => void,
  onError: (error: string) => void,
  onCitations?: (citations: string[]) => void,
): ChatStreamHandle {
  const controller = new AbortController();
  // Snippet IDs are only meaningful for the turn that produced them.
  const chatHistory: ChatHistoryItem[] = history.map(({ role, content }) => ({
    role,
    content: role === "assistant" ? stripCitations(content) : content,
  }));
  let finished = false;

  /** Ensure only one terminal callback fires. */
  const finish = (callback: () => void): void => {
    if (finished || controller.signal.aborted) return;
    finished = true;
    callback();
  };

  /** Dispatch a parsed event to the matching callback. */
  const dispatch = (event: StreamEvent): void => {
    switch (event.type) {
      case "token":
        onToken(event.content);
        break;
      case "sources":
        onSources(event.content);
        break;
      case "citations":
        onCitations?.(event.content);
        break;
      case "error":
        finish(() => onError(event.content));
        break;
      case "done":
        finish(onDone);
        break;
    }
  };

  /** Read the response body and process SSE events as they arrive. */
  const run = async (): Promise<void> => {
    let response: Response;
    try {
      response = await fetch(`${API_BASE_URL}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
        body: JSON.stringify({ query, chat_history: chatHistory }),
        signal: controller.signal,
      });
    } catch {
      finish(() => onError("Cannot reach the server. Check your connection and try again."));
      return;
    }

    if (!response.ok) {
      let message = `Request failed with status ${response.status}.`;
      try {
        const body: unknown = await response.json();
        if (isApiErrorBody(body)) message = body.detail;
      } catch {
        // keep the generic message
      }
      finish(() => onError(message));
      return;
    }

    if (!response.body) {
      finish(() => onError("The server returned an empty response."));
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const blocks = buffer.split(/\r?\n\r?\n/);
        buffer = blocks.pop() ?? "";
        for (const block of blocks) {
          const event = parseEventBlock(block);
          if (event) dispatch(event);
        }
      }
      buffer += decoder.decode();
      const trailing = parseEventBlock(buffer);
      if (trailing) dispatch(trailing);
      finish(() => onError("The connection closed before the answer was complete."));
    } catch {
      finish(() => onError("The connection was interrupted. Please retry."));
    }
  };

  void run();

  return {
    close: () => controller.abort(),
  };
}
