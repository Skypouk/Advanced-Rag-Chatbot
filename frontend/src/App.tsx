import { Bot, FileSearch, Menu } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { checkHealth } from "./api/client";
import { ChatWindow } from "./components/ChatWindow";
import { DocumentViewer } from "./components/DocumentViewer";
import { Sidebar } from "./components/Sidebar";
import { useChat } from "./hooks/useChat";
import { useDocuments } from "./hooks/useDocuments";
import { buildViewerTarget, parseDeepLink } from "./lib/citations";
import type { HealthStatus, Message, ViewerTarget } from "./types";

/** How often the backend health is polled (ms). */
const HEALTH_POLL_INTERVAL_MS = 30_000;

/** UI state of the health indicator. */
type HealthState = { kind: "checking" } | { kind: "ok" | "degraded"; health: HealthStatus } | { kind: "offline" };

/** Header badge showing backend / Ollama / ChromaDB connectivity. */
function HealthIndicator({ state }: { state: HealthState }) {
  let dot = "bg-slate-300";
  let label = "Checking…";
  let detail = "Checking backend status";

  if (state.kind === "ok") {
    dot = "bg-emerald-500";
    label = "Online";
    detail = "Backend, Ollama and ChromaDB are reachable";
  } else if (state.kind === "degraded") {
    dot = "bg-amber-500";
    label = "Degraded";
    const problems = [
      !state.health.ollama && "Ollama is not reachable — is it running and are the models pulled?",
      !state.health.chromadb && "ChromaDB is not reachable",
    ].filter(Boolean);
    detail = problems.join(" · ");
  } else if (state.kind === "offline") {
    dot = "bg-red-500";
    label = "Offline";
    detail = "Cannot reach the backend API";
  }

  return (
    <div className="group relative">
      <div
        className="flex items-center gap-2 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs text-slate-600"
        role="status"
        aria-label={`System status: ${label}. ${detail}`}
      >
        <span className="relative flex h-2 w-2">
          {state.kind === "ok" && (
            <span className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-60 ${dot}`} />
          )}
          <span className={`relative inline-flex h-2 w-2 rounded-full ${dot}`} />
        </span>
        <span className="hidden sm:inline">{label}</span>
      </div>
      <div className="pointer-events-none absolute right-0 top-full z-50 mt-2 w-64 rounded-lg border border-slate-200 bg-white p-3 text-xs text-slate-600 opacity-0 shadow-lg transition-opacity group-hover:opacity-100">
        <p className="font-medium text-slate-800">{detail}</p>
        {(state.kind === "ok" || state.kind === "degraded") && (
          <ul className="mt-2 space-y-1">
            <li className="flex justify-between">
              <span>Ollama</span>
              <span className={state.health.ollama ? "text-emerald-600" : "text-red-600"}>
                {state.health.ollama ? "connected" : "unreachable"}
              </span>
            </li>
            <li className="flex justify-between">
              <span>ChromaDB</span>
              <span className={state.health.chromadb ? "text-emerald-600" : "text-red-600"}>
                {state.health.chromadb ? "connected" : "unreachable"}
              </span>
            </li>
          </ul>
        )}
      </div>
    </div>
  );
}

/**
 * Root component: header with health status, document sidebar, chat panel
 * and the source viewer that shows cited sentences in the original document.
 */
export default function App() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [healthState, setHealthState] = useState<HealthState>({ kind: "checking" });
  // Deep links (?doc=…&page=…&hl=…) open the viewer directly.
  const [viewerTarget, setViewerTarget] = useState<ViewerTarget | null>(() => parseDeepLink(window.location));
  const [viewerOpen, setViewerOpen] = useState(() => viewerTarget !== null);
  const [activeSource, setActiveSource] = useState<{ messageId: string; snippetId: string } | null>(null);

  const docs = useDocuments();
  const chat = useChat();

  /** Poll the backend health endpoint. */
  const refreshHealth = useCallback(async (): Promise<void> => {
    try {
      const health = await checkHealth();
      setHealthState({ kind: health.ollama && health.chromadb ? "ok" : "degraded", health });
    } catch {
      setHealthState({ kind: "offline" });
    }
  }, []);

  useEffect(() => {
    void refreshHealth();
    const timer = window.setInterval(() => void refreshHealth(), HEALTH_POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [refreshHealth]);

  /** Open a snippet of an answer in the document viewer. */
  const openSource = useCallback((message: Message, snippetId: string) => {
    const target = buildViewerTarget(message.sources ?? [], message.citations ?? [], snippetId);
    if (!target) return;
    setViewerTarget(target);
    setViewerOpen(true);
    setActiveSource({ messageId: message.id, snippetId });
  }, []);

  // When an answer finishes, show its first citation in the viewer.
  const autoOpened = useRef<string | null>(null);
  useEffect(() => {
    const last = chat.messages[chat.messages.length - 1];
    if (!last || last.role !== "assistant" || last.isStreaming || autoOpened.current === last.id) return;
    const first = last.citations?.[0];
    if (!first) return;
    autoOpened.current = last.id;
    openSource(last, first);
  }, [chat.messages, openSource]);

  // Close the viewer if its document was deleted.
  useEffect(() => {
    if (!viewerTarget || docs.isLoading || docs.listError) return;
    if (!docs.documents.some((d) => d.doc_id === viewerTarget.docId)) {
      setViewerTarget(null);
      setActiveSource(null);
    }
  }, [docs.documents, docs.isLoading, docs.listError, viewerTarget]);

  /** Close the viewer and clear any deep link from the address bar. */
  const closeViewer = useCallback(() => {
    setViewerOpen(false);
    setActiveSource(null);
    if (window.location.search) window.history.replaceState(null, "", window.location.pathname);
  }, []);

  /** Clear the chat (and the viewer state that belongs to it). */
  const clearChat = useCallback(() => {
    chat.clearHistory();
    setActiveSource(null);
  }, [chat]);

  const showViewer = viewerOpen && viewerTarget !== null;

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-slate-50 text-slate-900">
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-slate-200 bg-white px-3 md:px-5">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setSidebarOpen(true)}
            className="rounded-md p-1.5 text-slate-600 hover:bg-slate-100 md:hidden"
            aria-label="Open documents sidebar"
          >
            <Menu className="h-5 w-5" />
          </button>
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600 text-white">
            <Bot className="h-5 w-5" aria-hidden="true" />
          </div>
          <div>
            <h1 className="text-sm font-semibold leading-tight text-slate-900">RAG Chatbot</h1>
            <p className="hidden text-[11px] leading-tight text-slate-500 sm:block">
              Answers grounded in cited sentences, locally
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {viewerTarget && !viewerOpen && (
            <button
              type="button"
              onClick={() => setViewerOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-50"
            >
              <FileSearch className="h-3.5 w-3.5" aria-hidden="true" />
              <span className="hidden sm:inline">Show source</span>
            </button>
          )}
          <HealthIndicator state={healthState} />
        </div>
      </header>

      {healthState.kind === "offline" && (
        <div className="shrink-0 border-b border-red-200 bg-red-50 px-4 py-2 text-center text-xs text-red-700" role="alert">
          Cannot reach the backend API. Make sure the backend container is running on port 8000.
        </div>
      )}
      {healthState.kind === "degraded" && !healthState.health.ollama && (
        <div className="shrink-0 border-b border-amber-200 bg-amber-50 px-4 py-2 text-center text-xs text-amber-800" role="alert">
          Ollama is not reachable. Uploads and answers will fail until it is running and the models are pulled.
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <Sidebar
          isOpen={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
          documents={docs.documents}
          isLoading={docs.isLoading}
          listError={docs.listError}
          uploadStatus={docs.uploadStatus}
          deletingFilename={docs.deletingFilename}
          onUpload={docs.uploadDocument}
          onDelete={docs.deleteDocument}
          onRefresh={() => void docs.fetchDocuments()}
          onResetUploadStatus={docs.resetUploadStatus}
        />
        <main className={`min-w-0 flex-1 flex-col ${showViewer ? "hidden lg:flex" : "flex"}`}>
          <ChatWindow
            messages={chat.messages}
            isStreaming={chat.isStreaming}
            validationError={chat.validationError}
            hasDocuments={docs.documents.length > 0}
            onSend={chat.sendMessage}
            onStop={chat.stopStreaming}
            onRetry={chat.retryLast}
            onClear={clearChat}
            onOpenSource={openSource}
            activeSource={activeSource}
          />
        </main>
        {showViewer && (
          <aside className="flex min-w-0 flex-1 flex-col border-l border-slate-200 lg:max-w-[50%] lg:flex-none lg:basis-[48%]">
            <DocumentViewer target={viewerTarget} documents={docs.documents} onClose={closeViewer} />
          </aside>
        )}
      </div>
    </div>
  );
}
