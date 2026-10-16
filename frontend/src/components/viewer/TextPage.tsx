import type { ReactNode } from "react";

import type { HighlightKind } from "../../types";

/** A character range to mark in the page text. */
export interface TextHighlight {
  id: string;
  kind: HighlightKind;
  start: number;
  end: number;
  label?: string;
}

interface TextPageProps {
  text: string;
  highlights: TextHighlight[];
  onHighlightClick?: (id: string) => void;
}

/** Tailwind classes per highlight kind. */
const KIND_CLASSES: Record<HighlightKind, string> = {
  active: "bg-orange-300 ring-2 ring-orange-500",
  cited: "bg-yellow-200",
  evidence: "bg-sky-100",
};

const PRIORITY: Record<HighlightKind, number> = { evidence: 0, cited: 1, active: 2 };

/**
 * Split text into segments, each covered by at most one highlight (the one
 * with the highest priority wins where ranges overlap).
 *
 * @param length - Text length.
 * @param highlights - Ranges to mark.
 * @returns Segments `[start, end, highlight | null]`.
 */
function segment(length: number, highlights: TextHighlight[]): Array<[number, number, TextHighlight | null]> {
  const points = new Set<number>([0, length]);
  for (const h of highlights) {
    points.add(Math.max(0, Math.min(length, h.start)));
    points.add(Math.max(0, Math.min(length, h.end)));
  }
  const sorted = [...points].sort((a, b) => a - b);
  const segments: Array<[number, number, TextHighlight | null]> = [];
  for (let i = 0; i < sorted.length - 1; i += 1) {
    const [start, end] = [sorted[i], sorted[i + 1]];
    if (start === end) continue;
    let best: TextHighlight | null = null;
    for (const h of highlights) {
      if (h.start <= start && h.end >= end && (!best || PRIORITY[h.kind] > PRIORITY[best.kind])) best = h;
    }
    segments.push([start, end, best]);
  }
  return segments;
}

/**
 * Render a page of extracted text with highlighted sentences
 * (used for DOCX/TXT files and as a fallback for PDFs).
 */
export function TextPage({ text, highlights, onHighlightClick }: TextPageProps) {
  const nodes: ReactNode[] = segment(text.length, highlights).map(([start, end, highlight]) => {
    const chunk = text.slice(start, end);
    if (!highlight) return <span key={start}>{chunk}</span>;
    return (
      <mark
        key={start}
        data-highlight={highlight.id}
        title={highlight.label}
        onClick={() => onHighlightClick?.(highlight.id)}
        className={`cursor-pointer rounded-sm px-0.5 text-slate-900 transition-colors ${KIND_CLASSES[highlight.kind]}`}
      >
        {chunk}
      </mark>
    );
  });

  return (
    <article className="mx-auto max-w-3xl whitespace-pre-wrap break-words rounded-lg bg-white p-6 font-serif text-[15px] leading-7 text-slate-700 shadow-md ring-1 ring-slate-200">
      {nodes}
    </article>
  );
}

export default TextPage;
