import type { Highlight, SourceDocument, ViewerTarget } from "../types";

/** Matches citation groups such as `[S1]`, `[S1, S3]` or `[S2; S4]`. */
const CITATION_GROUP = /\[\s*S\d+(?:\s*[,;]\s*S?\d+)*\s*\]/gi;

/** Href prefix used for citation links inside rendered Markdown. */
export const CITE_HREF_PREFIX = "#cite-";

/** Counter that makes every viewer navigation unique. */
let navigationCounter = 0;

/**
 * Return a fresh nonce for a viewer navigation.
 *
 * @returns A monotonically increasing number.
 */
export function nextNonce(): number {
  navigationCounter += 1;
  return navigationCounter;
}

/**
 * Split a citation group like "[S1, 3]" into normalized snippet IDs.
 *
 * @param group - The matched citation text, brackets included.
 * @returns IDs such as `["S1", "S3"]`.
 */
function idsInGroup(group: string): string[] {
  return Array.from(group.slice(1, -1).matchAll(/S?(\d+)/gi), (match) => `S${Number(match[1])}`);
}

/**
 * Turn citation markers into Markdown links so they render as clickable chips.
 *
 * @param markdown - The assistant's answer.
 * @returns Markdown where `[S1, S3]` becomes `[S1](#cite-S1)[S3](#cite-S3)`.
 */
export function linkifyCitations(markdown: string): string {
  return markdown.replace(CITATION_GROUP, (group) =>
    idsInGroup(group)
      .map((id) => `[${id}](${CITE_HREF_PREFIX}${id})`)
      .join(""),
  );
}

/**
 * Remove citation markers (used before sending history back to the LLM,
 * because snippet IDs are only valid for the turn that produced them).
 *
 * @param text - Text containing citation markers.
 * @returns The text without them.
 */
export function stripCitations(text: string): string {
  return text.replace(new RegExp(`\\s*${CITATION_GROUP.source}`, "gi"), "");
}

/**
 * Build the viewer target for a snippet of an answer.
 *
 * All evidence from the same document is included so the viewer can show
 * cited sentences (strong) and the remaining evidence (faint).
 *
 * @param sources - Evidence snippets of the answer.
 * @param citations - Snippet IDs cited by the answer.
 * @param focusId - Snippet to open and scroll to.
 * @returns The target, or null if the snippet is unknown.
 */
export function buildViewerTarget(
  sources: SourceDocument[],
  citations: string[],
  focusId: string,
): ViewerTarget | null {
  const focus = sources.find((s) => s.id === focusId);
  if (!focus) return null;
  const cited = new Set(citations);
  const highlights: Highlight[] = sources
    .filter((s) => s.doc_id === focus.doc_id)
    .map((s) => ({
      id: s.id,
      page: s.page,
      start: s.start,
      end: s.end,
      cited: cited.has(s.id) || s.id === focusId,
      text: s.text,
    }));
  return {
    docId: focus.doc_id,
    filename: focus.filename,
    page: focus.page,
    highlights,
    focusId,
    nonce: nextNonce(),
  };
}

/**
 * Build a shareable deep link that opens the viewer at a highlight.
 *
 * Format: `/?doc=<doc_id>&page=<n>&hl=<start>-<end>#<snippet id>`.
 *
 * @param docId - Document id.
 * @param page - 1-based page number.
 * @param highlight - Optional highlighted range.
 * @returns An absolute URL on the current origin.
 */
export function buildDeepLink(docId: string, page: number, highlight?: Pick<Highlight, "id" | "start" | "end">): string {
  const params = new URLSearchParams({ doc: docId, page: String(page) });
  if (highlight) params.set("hl", `${highlight.start}-${highlight.end}`);
  const hash = highlight ? `#${encodeURIComponent(highlight.id)}` : "";
  return `${window.location.origin}${window.location.pathname}?${params.toString()}${hash}`;
}

/**
 * Parse a deep link from the current URL.
 *
 * @param location - Typically `window.location`.
 * @returns The viewer target encoded in the URL, or null.
 */
export function parseDeepLink(location: Pick<Location, "search" | "hash">): ViewerTarget | null {
  const params = new URLSearchParams(location.search);
  const docId = params.get("doc");
  if (!docId || !/^[0-9a-f]{16}$/.test(docId)) return null;
  const page = Math.max(1, Number.parseInt(params.get("page") ?? "1", 10) || 1);
  const match = /^(\d+)-(\d+)$/.exec(params.get("hl") ?? "");
  const id = decodeURIComponent(location.hash.replace(/^#/, "")) || "link";
  const highlights: Highlight[] = match
    ? [{ id, page, start: Number(match[1]), end: Number(match[2]), cited: true }]
    : [];
  return { docId, page, highlights, focusId: highlights[0]?.id, nonce: nextNonce() };
}
