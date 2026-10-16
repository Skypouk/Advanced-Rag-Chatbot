import { AlertCircle, Bot, ChevronDown, ChevronRight, RotateCcw, User } from "lucide-react";
import { useMemo, useState } from "react";
import type { Components } from "react-markdown";
import ReactMarkdown from "react-markdown";
import { PrismAsyncLight as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import remarkGfm from "remark-gfm";

import { CITE_HREF_PREFIX, linkifyCitations } from "../lib/citations";
import type { Message, SourceDocument } from "../types";
import { SourceCard } from "./SourceCard";

interface MessageBubbleProps {
  message: Message;
  /** Open a snippet of this message in the document viewer. */
  onOpenSource?: (message: Message, snippetId: string) => void;
  /** Snippet currently shown in the viewer, if it belongs to this message. */
  activeSnippetId?: string;
  /** Called when the user clicks "Retry" on a failed answer. */
  onRetry?: () => void;
  /** Whether retrying is currently allowed. */
  canRetry?: boolean;
}

/**
 * Format a timestamp as a short local time string.
 *
 * @param timestamp - Milliseconds since epoch.
 * @returns e.g. "14:05".
 */
function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/**
 * Build Markdown renderers: syntax-highlighted code, citation chips and safe links.
 *
 * @param onCite - Called with a snippet ID when a citation chip is clicked.
 * @param knownIds - Snippet IDs that exist for this message.
 * @param activeId - Snippet currently shown in the viewer.
 * @returns react-markdown component overrides.
 */
function createMarkdownComponents(
  onCite: (snippetId: string) => void,
  knownIds: Set<string>,
  activeId: string | undefined,
): Components {
  return {
    code({ className, children, ...rest }) {
      const match = /language-(\w+)/.exec(className ?? "");
      const code = String(children).replace(/\n$/, "");
      if (match) {
        return (
          <SyntaxHighlighter language={match[1]} style={oneDark} PreTag="div">
            {code}
          </SyntaxHighlighter>
        );
      }
      return (
        <code className={className} {...rest}>
          {children}
        </code>
      );
    },
    pre({ children }) {
      return <div className="not-prose my-2 overflow-hidden rounded-lg text-[13px] [&>div]:!m-0">{children}</div>;
    },
    a({ children, href }) {
      if (href?.startsWith(CITE_HREF_PREFIX)) {
        const id = href.slice(CITE_HREF_PREFIX.length);
        if (!knownIds.has(id)) {
          // The model cited an ID that was not in the evidence.
          return (
            <span className="text-[0.7em] text-slate-400 line-through" title="Unknown snippet">
              {id}
            </span>
          );
        }
        return (
          <button
            type="button"
            onClick={() => onCite(id)}
            className={`not-prose mx-0.5 inline-flex -translate-y-0.5 items-center rounded px-1 py-px align-baseline text-[0.7em] font-semibold leading-tight transition-colors ${
              id === activeId ? "bg-orange-400 text-slate-900" : "bg-yellow-200 text-slate-800 hover:bg-yellow-300"
            }`}
            title={`Show source ${id} in the document`}
          >
            {children}
          </button>
        );
      }
      return (
        <a href={href} target="_blank" rel="noreferrer noopener">
          {children}
        </a>
      );
    },
  };
}

/** Animated three-dot indicator shown before the first token arrives. */
function TypingIndicator() {
  return (
    <div className="flex items-center gap-1 py-1" aria-label="Assistant is typing">
      <span className="h-2 w-2 animate-bounce rounded-full bg-slate-400 [animation-delay:-0.3s]" />
      <span className="h-2 w-2 animate-bounce rounded-full bg-slate-400 [animation-delay:-0.15s]" />
      <span className="h-2 w-2 animate-bounce rounded-full bg-slate-400" />
    </div>
  );
}

/**
 * Render a single chat message: user (right, colored) or assistant (left,
 * Markdown with clickable citation chips and the cited evidence sentences).
 */
export function MessageBubble({ message, onOpenSource, activeSnippetId, onRetry, canRetry = true }: MessageBubbleProps) {
  const [showSources, setShowSources] = useState(true);
  const [showEvidence, setShowEvidence] = useState(false);
  const isUser = message.role === "user";
  const hasContent = message.content.length > 0;

  const { citedSet, primarySources, secondarySources, knownIds } = useMemo(() => {
    const sources = message.sources ?? [];
    const citations = message.citations ?? [];
    const cited = new Set(citations);
    const citedSources = citations
      .map((id) => sources.find((s) => s.id === id))
      .filter((s): s is SourceDocument => s !== undefined);
    // Before citations arrive (or if the model cited nothing), show the direct hits.
    return {
      citedSet: cited,
      primarySources: citations.length > 0 ? citedSources : sources.filter((s) => s.is_hit),
      secondarySources: citations.length > 0 ? sources.filter((s) => !cited.has(s.id)) : sources.filter((s) => !s.is_hit),
      knownIds: new Set(sources.map((s) => s.id)),
    };
  }, [message.sources, message.citations]);

  const components = useMemo(
    () => createMarkdownComponents((id) => onOpenSource?.(message, id), knownIds, activeSnippetId),
    [onOpenSource, message, knownIds, activeSnippetId],
  );

  /** Open a snippet in the document viewer. */
  const open = (snippetId: string): void => onOpenSource?.(message, snippetId);
  const citationCount = citedSet.size;
  const sourceCount = (message.sources ?? []).length;

  return (
    <div className={`group flex w-full gap-3 ${isUser ? "flex-row-reverse" : "flex-row"}`}>
      <div
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
          isUser ? "bg-indigo-600 text-white" : "bg-slate-200 text-slate-600"
        }`}
        aria-hidden="true"
      >
        {isUser ? <User className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
      </div>

      <div className={`flex min-w-0 max-w-[85%] flex-col md:max-w-[90%] ${isUser ? "items-end" : "items-start"}`}>
        <div
          className={`rounded-2xl px-4 py-2.5 shadow-sm ${
            isUser
              ? "rounded-tr-sm bg-indigo-600 text-white"
              : "rounded-tl-sm border border-slate-200 bg-white text-slate-800"
          }`}
        >
          {isUser ? (
            <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{message.content}</p>
          ) : (
            <>
              {!hasContent && message.isStreaming && <TypingIndicator />}
              {hasContent && (
                <div className="prose prose-sm prose-slate max-w-none break-words prose-p:my-1.5 prose-pre:my-0 prose-code:before:content-none prose-code:after:content-none">
                  <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
                    {linkifyCitations(message.content)}
                  </ReactMarkdown>
                  {message.isStreaming && (
                    <span
                      className="ml-0.5 inline-block h-4 w-[2px] translate-y-0.5 animate-blink bg-slate-700"
                      aria-hidden="true"
                    />
                  )}
                </div>
              )}
              {message.error && (
                <div
                  className={`flex items-start gap-2 text-sm text-red-700 ${hasContent ? "mt-2 border-t border-red-100 pt-2" : ""}`}
                  role="alert"
                >
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                  <div className="flex-1">
                    <p>{message.error}</p>
                    {onRetry && (
                      <button
                        type="button"
                        onClick={onRetry}
                        disabled={!canRetry}
                        className="mt-1.5 inline-flex items-center gap-1 rounded-md border border-red-200 bg-red-50 px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <RotateCcw className="h-3 w-3" aria-hidden="true" />
                        Retry
                      </button>
                    )}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {!isUser && sourceCount > 0 && (
          <div className="mt-1.5 w-full">
            <button
              type="button"
              onClick={() => setShowSources((value) => !value)}
              className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-slate-700"
              aria-expanded={showSources}
            >
              {showSources ? (
                <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
              ) : (
                <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
              )}
              {citationCount > 0
                ? `${citationCount} cited source${citationCount === 1 ? "" : "s"}`
                : `${primarySources.length} retrieved sentence${primarySources.length === 1 ? "" : "s"}`}
            </button>
            {showSources && (
              <div className="mt-1.5 grid gap-1.5">
                {primarySources.map((source) => (
                  <SourceCard
                    key={source.id}
                    source={source}
                    cited={citedSet.has(source.id)}
                    active={source.id === activeSnippetId}
                    onOpen={open}
                  />
                ))}
                {secondarySources.length > 0 && (
                  <>
                    <button
                      type="button"
                      onClick={() => setShowEvidence((value) => !value)}
                      className="inline-flex items-center gap-1 justify-self-start text-[11px] text-slate-400 hover:text-slate-600"
                      aria-expanded={showEvidence}
                    >
                      {showEvidence ? (
                        <ChevronDown className="h-3 w-3" aria-hidden="true" />
                      ) : (
                        <ChevronRight className="h-3 w-3" aria-hidden="true" />
                      )}
                      {secondarySources.length} more evidence sentence{secondarySources.length === 1 ? "" : "s"} given
                      to the model
                    </button>
                    {showEvidence &&
                      secondarySources.map((source) => (
                        <SourceCard
                          key={source.id}
                          source={source}
                          cited={false}
                          active={source.id === activeSnippetId}
                          onOpen={open}
                        />
                      ))}
                  </>
                )}
              </div>
            )}
          </div>
        )}

        <span className="mt-1 text-[11px] text-slate-400 opacity-0 transition-opacity group-hover:opacity-100">
          {formatTime(message.timestamp)}
        </span>
      </div>
    </div>
  );
}

export default MessageBubble;
