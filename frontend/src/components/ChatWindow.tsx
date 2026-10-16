import { MessageSquareText, Trash2, UploadCloud } from "lucide-react";
import { useEffect, useRef } from "react";

import type { Message } from "../types";
import { ChatInput } from "./ChatInput";
import { MessageBubble } from "./MessageBubble";

interface ChatWindowProps {
  messages: Message[];
  isStreaming: boolean;
  validationError: string | null;
  hasDocuments: boolean;
  onSend: (message: string) => boolean;
  onStop: () => void;
  onRetry: () => void;
  onClear: () => void;
  /** Open a snippet of an answer in the document viewer. */
  onOpenSource: (message: Message, snippetId: string) => void;
  /** Message id + snippet currently shown in the viewer. */
  activeSource: { messageId: string; snippetId: string } | null;
}

/** Example prompts shown in the empty state. */
const SUGGESTIONS = [
  "Summarize the main points of the document",
  "What are the key definitions?",
  "List any deadlines or dates mentioned",
];

/**
 * Chat panel: scrollable message list with auto-scroll, empty state,
 * streaming indicator and the input bar.
 */
export function ChatWindow({
  messages,
  isStreaming,
  validationError,
  hasDocuments,
  onSend,
  onStop,
  onRetry,
  onClear,
  onOpenSource,
  activeSource,
}: ChatWindowProps) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const lastMessage = messages[messages.length - 1];

  // Scroll to the bottom when messages are added or the streamed text grows.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: isStreaming ? "auto" : "smooth", block: "end" });
  }, [messages.length, lastMessage?.content, lastMessage?.sources, lastMessage?.citations, lastMessage?.error, isStreaming]);

  const lastAssistantId = [...messages].reverse().find((m) => m.role === "assistant")?.id;

  return (
    <section className="flex h-full min-h-0 flex-1 flex-col bg-slate-50" aria-label="Chat">
      {messages.length > 0 && (
        <div className="flex items-center justify-between border-b border-slate-200 bg-white/80 px-4 py-2 backdrop-blur">
          <span className="text-xs text-slate-500">
            {messages.filter((m) => m.role === "user").length} question
            {messages.filter((m) => m.role === "user").length === 1 ? "" : "s"}
            {isStreaming && <span className="ml-2 text-indigo-600">· Generating answer…</span>}
          </span>
          <button
            type="button"
            onClick={onClear}
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-700"
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
            Clear chat
          </button>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto" role="log" aria-live="polite" aria-busy={isStreaming}>
        {messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center px-6 text-center">
            <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-100 text-indigo-600">
              {hasDocuments ? <MessageSquareText className="h-7 w-7" /> : <UploadCloud className="h-7 w-7" />}
            </div>
            <h2 className="text-lg font-semibold text-slate-800">Upload a document and start asking questions</h2>
            <p className="mt-1 max-w-md text-sm text-slate-500">
              {hasDocuments
                ? "Your documents are indexed. Ask anything — answers are grounded in your files with cited sources."
                : "Add a PDF, DOCX or TXT file from the sidebar. Everything runs locally on your machine."}
            </p>
            {hasDocuments && (
              <div className="mt-6 flex flex-wrap justify-center gap-2">
                {SUGGESTIONS.map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    onClick={() => onSend(suggestion)}
                    className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-600 shadow-sm hover:border-indigo-300 hover:text-indigo-700"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="mx-auto flex max-w-3xl flex-col gap-5 px-4 py-6">
            {messages.map((message) => (
              <MessageBubble
                key={message.id}
                message={message}
                onOpenSource={onOpenSource}
                activeSnippetId={activeSource?.messageId === message.id ? activeSource.snippetId : undefined}
                onRetry={message.id === lastAssistantId && message.error ? onRetry : undefined}
                canRetry={!isStreaming}
              />
            ))}
            <div ref={bottomRef} />
          </div>
        )}
      </div>

      <div className="border-t border-slate-200 bg-white px-4 pb-3 pt-3">
        <div className="mx-auto max-w-3xl">
          <ChatInput
            onSend={onSend}
            onStop={onStop}
            isStreaming={isStreaming}
            validationError={validationError}
            placeholder={hasDocuments ? undefined : "Upload a document first, then ask a question…"}
          />
        </div>
      </div>
    </section>
  );
}

export default ChatWindow;
