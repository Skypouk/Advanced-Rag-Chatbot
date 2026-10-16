import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Download,
  FileSearch,
  Link2,
  Loader2,
  Quote,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { documentFileUrl, getDocumentPage, getErrorMessage } from "../api/client";
import { buildDeepLink } from "../lib/citations";
import type { Document, Highlight, HighlightKind, PageResponse, ViewerTarget } from "../types";
import { PdfPage, ZOOM_LEVELS } from "./viewer/PdfPage";
import type { PdfHighlight } from "./viewer/PdfPage";
import { TextPage } from "./viewer/TextPage";
import type { TextHighlight } from "./viewer/TextPage";

interface DocumentViewerProps {
  target: ViewerTarget | null;
  /** Indexed documents, used to resolve versions and names. */
  documents: Document[];
  onClose: () => void;
}

/**
 * Decide how a highlight should look.
 *
 * @param highlight - The highlight.
 * @param focusId - Currently focused highlight id.
 * @returns The visual kind.
 */
function kindOf(highlight: Highlight, focusId: string | undefined): HighlightKind {
  if (highlight.id === focusId) return "active";
  return highlight.cited ? "cited" : "evidence";
}

/**
 * Right-hand panel that shows the original document with the evidence
 * sentences highlighted. PDFs render with pdf.js (exact sentence boxes);
 * DOCX/TXT render their extracted text with marked sentences.
 */
export function DocumentViewer({ target, documents, onClose }: DocumentViewerProps) {
  const [page, setPage] = useState(1);
  const [focusId, setFocusId] = useState<string | undefined>(undefined);
  const [pageData, setPageData] = useState<PageResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [zoomIndex, setZoomIndex] = useState(0);
  const [copied, setCopied] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const pendingScroll = useRef(false);

  const docId = target?.docId;
  const docMeta = documents.find((d) => d.doc_id === docId);
  const version = docMeta?.version ?? pageData?.version;

  // A new navigation (citation click / deep link) jumps to its page and highlight.
  useEffect(() => {
    if (!target) return;
    setPage(target.page);
    setFocusId(target.focusId);
    setPdfError(null);
    pendingScroll.current = true;
  }, [target]);

  // Load the page text + sentence boxes.
  useEffect(() => {
    if (!docId) return undefined;
    const controller = new AbortController();
    setIsLoading(true);
    setError(null);
    getDocumentPage(docId, page, controller.signal)
      .then((data) => {
        setPageData(data);
        setIsLoading(false);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setError(getErrorMessage(err));
        setPageData(null);
        setIsLoading(false);
      });
    return () => controller.abort();
  }, [docId, page, version]);

  const highlightsOnPage = useMemo(
    () => (target?.highlights ?? []).filter((h) => h.page === page),
    [target, page],
  );

  // Map each highlight's character range to the stored sentence rectangles.
  const pdfHighlights: PdfHighlight[] = useMemo(() => {
    if (!pageData) return [];
    return highlightsOnPage.map((h) => ({
      id: h.id,
      kind: kindOf(h, focusId),
      label: h.text ? `[${h.id}] ${h.text}` : h.id,
      rects: pageData.sentences
        .filter((s) => s.start < h.end && s.end > h.start)
        .flatMap((s) => s.rects),
    }));
  }, [pageData, highlightsOnPage, focusId]);

  const textHighlights: TextHighlight[] = useMemo(
    () =>
      highlightsOnPage.map((h) => ({
        id: h.id,
        kind: kindOf(h, focusId),
        start: h.start,
        end: h.end,
        label: h.text ? `[${h.id}] ${h.text}` : h.id,
      })),
    [highlightsOnPage, focusId],
  );

  const hasPdfGeometry =
    pageData?.file_type === "pdf" &&
    Boolean(pageData.page.width && pageData.page.height) &&
    (highlightsOnPage.length === 0 || pdfHighlights.some((h) => h.rects.length > 0));
  const showPdf = hasPdfGeometry && !pdfError;

  /** Scroll the focused highlight into view once it is in the DOM. */
  const scrollToFocus = useCallback(() => {
    if (!pendingScroll.current) return;
    const container = scrollRef.current;
    if (!container) return;
    const selector = focusId ? `[data-highlight="${CSS.escape(focusId)}"]` : "[data-highlight]";
    const el = container.querySelector(selector) ?? container.querySelector("[data-highlight]");
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
      pendingScroll.current = false;
    }
  }, [focusId]);

  // Text pages render synchronously: scroll after the data arrives.
  useEffect(() => {
    if (pageData && !showPdf) requestAnimationFrame(scrollToFocus);
  }, [pageData, showPdf, scrollToFocus, target]);

  /** Focus a highlight clicked in the document or in the snippet list. */
  const focusHighlight = useCallback(
    (id: string) => {
      const highlight = target?.highlights.find((h) => h.id === id);
      if (!highlight) return;
      setFocusId(id);
      pendingScroll.current = true;
      if (highlight.page !== page) setPage(highlight.page);
      else requestAnimationFrame(scrollToFocus);
    },
    [target, page, scrollToFocus],
  );

  /** Copy a deep link to the focused highlight (or current page). */
  const copyLink = async (): Promise<void> => {
    if (!docId) return;
    const focused = target?.highlights.find((h) => h.id === focusId && h.page === page);
    try {
      await navigator.clipboard.writeText(buildDeepLink(docId, page, focused));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  const handlePdfError = useCallback((message: string) => setPdfError(message), []);

  if (!target) {
    return (
      <section className="flex h-full flex-col items-center justify-center bg-slate-100 px-8 text-center" aria-label="Document viewer">
        <FileSearch className="h-10 w-10 text-slate-300" aria-hidden="true" />
        <h2 className="mt-3 text-sm font-semibold text-slate-700">Source viewer</h2>
        <p className="mt-1 max-w-xs text-xs text-slate-500">
          Click a citation such as <span className="rounded bg-yellow-200 px-1 font-medium text-slate-800">S1</span> in
          an answer to open the original document with the supporting sentences highlighted.
        </p>
      </section>
    );
  }

  const pageCount = pageData?.page_count ?? docMeta?.page_count ?? 1;
  const filename = pageData?.filename ?? target.filename ?? docMeta?.filename ?? "Document";
  const pageLabel = pageData?.file_type === "pdf" ? "Page" : "Part";
  const sortedHighlights = [...target.highlights].sort((a, b) => a.page - b.page || a.start - b.start);

  return (
    <section className="flex h-full min-h-0 flex-col bg-slate-100" aria-label="Document viewer">
      {/* Toolbar */}
      <div className="flex items-center gap-2 border-b border-slate-200 bg-white px-3 py-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-slate-800" title={filename}>
            {filename}
          </p>
          <p className="text-[11px] text-slate-500">
            {target.highlights.filter((h) => h.cited).length} cited · {target.highlights.length} evidence sentences
          </p>
        </div>
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1}
            className="rounded p-1.5 text-slate-500 hover:bg-slate-100 disabled:opacity-30"
            aria-label="Previous page"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="min-w-[4.5rem] text-center text-xs tabular-nums text-slate-600">
            {pageLabel} {page} / {pageCount}
          </span>
          <button
            type="button"
            onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
            disabled={page >= pageCount}
            className="rounded p-1.5 text-slate-500 hover:bg-slate-100 disabled:opacity-30"
            aria-label="Next page"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
        {showPdf && (
          <div className="flex items-center gap-0.5 border-l border-slate-200 pl-2">
            <button
              type="button"
              onClick={() => setZoomIndex((z) => Math.max(0, z - 1))}
              disabled={zoomIndex === 0}
              className="rounded p-1.5 text-slate-500 hover:bg-slate-100 disabled:opacity-30"
              aria-label="Zoom out"
            >
              <ZoomOut className="h-4 w-4" />
            </button>
            <span className="w-9 text-center text-[11px] tabular-nums text-slate-500">
              {Math.round(ZOOM_LEVELS[zoomIndex] * 100)}%
            </span>
            <button
              type="button"
              onClick={() => setZoomIndex((z) => Math.min(ZOOM_LEVELS.length - 1, z + 1))}
              disabled={zoomIndex === ZOOM_LEVELS.length - 1}
              className="rounded p-1.5 text-slate-500 hover:bg-slate-100 disabled:opacity-30"
              aria-label="Zoom in"
            >
              <ZoomIn className="h-4 w-4" />
            </button>
          </div>
        )}
        <div className="flex items-center gap-0.5 border-l border-slate-200 pl-2">
          <button
            type="button"
            onClick={() => void copyLink()}
            className="rounded p-1.5 text-slate-500 hover:bg-slate-100"
            aria-label="Copy link to this highlight"
            title={copied ? "Link copied!" : "Copy deep link"}
          >
            <Link2 className={`h-4 w-4 ${copied ? "text-emerald-600" : ""}`} />
          </button>
          <a
            href={documentFileUrl(target.docId, version)}
            target="_blank"
            rel="noreferrer"
            className="rounded p-1.5 text-slate-500 hover:bg-slate-100"
            aria-label="Open original file"
            title="Open original file"
          >
            <Download className="h-4 w-4" />
          </a>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1.5 text-slate-500 hover:bg-slate-100"
            aria-label="Close viewer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Evidence snippet list */}
      {sortedHighlights.length > 0 && (
        <div className="flex gap-1.5 overflow-x-auto border-b border-slate-200 bg-white/70 px-3 py-2">
          {sortedHighlights.map((h) => (
            <button
              key={h.id}
              type="button"
              onClick={() => focusHighlight(h.id)}
              title={h.text}
              className={`flex max-w-[14rem] shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] transition-colors ${
                h.id === focusId
                  ? "border-orange-400 bg-orange-100 text-orange-900"
                  : h.cited
                    ? "border-yellow-300 bg-yellow-50 text-slate-700 hover:bg-yellow-100"
                    : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50"
              }`}
            >
              <span className="font-semibold">{h.id}</span>
              <span className="text-slate-400">p.{h.page}</span>
              {h.text && <span className="truncate">{h.text}</span>}
            </button>
          ))}
        </div>
      )}

      {/* Document */}
      <div ref={scrollRef} className="relative min-h-0 flex-1 overflow-auto p-4">
        {error ? (
          <div className="mx-auto mt-10 flex max-w-sm items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700" role="alert">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{error}</span>
          </div>
        ) : !pageData ? (
          <div className="flex h-full items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-indigo-500" aria-label="Loading document" />
          </div>
        ) : (
          <>
            {pdfError && (
              <p className="mx-auto mb-3 max-w-3xl rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800" role="status">
                {pdfError} Showing the extracted text instead.
              </p>
            )}
            {showPdf && pageData.page.width && pageData.page.height ? (
              <div className={`flex ${zoomIndex === 0 ? "justify-center" : "justify-start"}`}>
                <PdfPage
                  url={documentFileUrl(target.docId, version)}
                  page={page}
                  pageWidth={pageData.page.width}
                  pageHeight={pageData.page.height}
                  highlights={pdfHighlights}
                  zoomIndex={zoomIndex}
                  onHighlightClick={focusHighlight}
                  onRendered={scrollToFocus}
                  onError={handlePdfError}
                />
              </div>
            ) : (
              <TextPage text={pageData.page.text} highlights={textHighlights} onHighlightClick={focusHighlight} />
            )}
            {isLoading && (
              <div className="absolute right-4 top-4">
                <Loader2 className="h-4 w-4 animate-spin text-indigo-500" aria-label="Loading page" />
              </div>
            )}
          </>
        )}
      </div>

      {focusId && target.highlights.find((h) => h.id === focusId)?.text && (
        <div className="flex items-start gap-2 border-t border-slate-200 bg-white px-4 py-2.5 text-xs text-slate-600">
          <Quote className="mt-0.5 h-3.5 w-3.5 shrink-0 text-orange-500" aria-hidden="true" />
          <p className="line-clamp-3">
            <span className="mr-1 font-semibold text-slate-800">[{focusId}]</span>
            {target.highlights.find((h) => h.id === focusId)?.text}
          </p>
        </div>
      )}
    </section>
  );
}

export default DocumentViewer;
