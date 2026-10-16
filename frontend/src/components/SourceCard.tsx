import { FileText, Quote } from "lucide-react";

import type { SourceDocument } from "../types";

/** Number of characters shown in the snippet preview. */
const SNIPPET_LENGTH = 150;

interface SourceCardProps {
  source: SourceDocument;
  /** Whether the answer cites this snippet. */
  cited: boolean;
  /** Whether this snippet is currently shown in the viewer. */
  active: boolean;
  /** Open the snippet in the document viewer. */
  onOpen: (snippetId: string) => void;
}

/**
 * Truncate text to a maximum length on a word boundary.
 *
 * @param text - Text to truncate.
 * @param max - Maximum number of characters.
 * @returns The truncated text with an ellipsis when shortened.
 */
function truncate(text: string, max: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

/**
 * One cited evidence sentence. Clicking it opens the original document in
 * the viewer with the sentence highlighted.
 */
export function SourceCard({ source, cited, active, onOpen }: SourceCardProps) {
  const pageLabel = source.file_type === "pdf" ? "p." : "part";

  return (
    <button
      type="button"
      onClick={() => onOpen(source.id)}
      title="Show in document"
      className={`group/card flex w-full items-start gap-2 rounded-lg border p-2.5 text-left text-xs transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300 ${
        active
          ? "border-orange-400 bg-orange-50"
          : cited
            ? "border-yellow-200 bg-yellow-50/60 hover:border-yellow-300 hover:bg-yellow-50"
            : "border-slate-200 bg-white/70 hover:border-slate-300"
      }`}
    >
      <span
        className={`mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold ${
          cited ? "bg-yellow-200 text-slate-800" : "bg-slate-100 text-slate-500"
        }`}
      >
        {source.id}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5 text-slate-500">
          <FileText className="h-3 w-3 shrink-0 text-indigo-500" aria-hidden="true" />
          <span className="truncate font-medium text-slate-700" title={source.filename}>
            {source.filename}
          </span>
          <span className="shrink-0">
            · {pageLabel} {source.page}
          </span>
          {typeof source.score === "number" && (
            <span className="ml-auto shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[10px]" title="Similarity">
              {Math.round(source.score * 100)}%
            </span>
          )}
        </span>
        <span className="mt-1 flex gap-1 leading-relaxed text-slate-600">
          <Quote className="mt-0.5 h-3 w-3 shrink-0 text-slate-300" aria-hidden="true" />
          <span className="break-words">{truncate(source.text, SNIPPET_LENGTH)}</span>
        </span>
      </span>
    </button>
  );
}

export default SourceCard;
