import { Loader2 } from "lucide-react";
import type { RenderTask } from "pdfjs-dist";
import { useEffect, useRef, useState } from "react";

import { getPdfDocument, isRenderCancelled } from "../../lib/pdf";
import type { HighlightKind, Rect } from "../../types";

/** A highlight ready to draw on the PDF page. */
export interface PdfHighlight {
  id: string;
  kind: HighlightKind;
  rects: Rect[];
  label?: string;
}

interface PdfPageProps {
  /** URL of the PDF file. */
  url: string;
  /** 1-based page number. */
  page: number;
  /** Page size in PDF points (from the backend), used for the overlay viewBox. */
  pageWidth: number;
  pageHeight: number;
  highlights: PdfHighlight[];
  /** Zoom level as an index into ZOOM_LEVELS (0 = fit width). */
  zoomIndex: number;
  onHighlightClick?: (id: string) => void;
  /** Called after the page has been drawn (used to scroll to a highlight). */
  onRendered?: () => void;
  onError: (message: string) => void;
}

/** Available zoom levels, relative to the panel width. */
export const ZOOM_LEVELS = [1, 1.25, 1.5, 2] as const;

/** Width classes matching ZOOM_LEVELS (Tailwind classes, no inline styles). */
const ZOOM_WIDTH_CLASSES = ["w-full", "w-[125%]", "w-[150%]", "w-[200%]"];

/** SVG fill/stroke classes per highlight kind. */
const KIND_CLASSES: Record<HighlightKind, string> = {
  active: "fill-orange-300/70 stroke-orange-600 [stroke-width:1.5]",
  cited: "fill-yellow-200/60 stroke-yellow-400 [stroke-width:0.75]",
  evidence: "fill-sky-200/40 stroke-transparent",
};

/** Padding (PDF points) added around each highlight rectangle. */
const PAD = 1.5;

/**
 * Render one PDF page with pdf.js and overlay highlight rectangles.
 *
 * The canvas fills the container width; the SVG overlay uses the page's
 * point coordinates as its viewBox, so rectangles from the backend line up
 * exactly regardless of zoom or device pixel ratio.
 */
export function PdfPage({
  url,
  page,
  pageWidth,
  pageHeight,
  highlights,
  zoomIndex,
  onHighlightClick,
  onRendered,
  onError,
}: PdfPageProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const [isRendering, setIsRendering] = useState(true);
  // Keep callbacks in refs so new handlers don't trigger a full re-render.
  const onRenderedRef = useRef(onRendered);
  const onErrorRef = useRef(onError);
  onRenderedRef.current = onRendered;
  onErrorRef.current = onError;

  // Track the rendered width so the page re-renders crisply on resize/zoom.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return undefined;
    const observer = new ResizeObserver((entries) => {
      const width = Math.floor(entries[0]?.contentRect.width ?? 0);
      setContainerWidth((previous) => (Math.abs(previous - width) > 4 ? width : previous));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Render the page to the canvas whenever the file, page, size or zoom changes.
  useEffect(() => {
    if (containerWidth === 0) return undefined;
    let cancelled = false;
    let task: RenderTask | null = null;
    setIsRendering(true);

    void (async () => {
      try {
        const pdf = await getPdfDocument(url);
        const pdfPage = await pdf.getPage(page);
        if (cancelled) return;
        const base = pdfPage.getViewport({ scale: 1 });
        const scale = containerWidth / base.width;
        const ratio = window.devicePixelRatio || 1;
        const viewport = pdfPage.getViewport({ scale: scale * ratio });

        const canvas = canvasRef.current;
        const context = canvas?.getContext("2d");
        if (!canvas || !context) return;
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);

        task = pdfPage.render({ canvasContext: context, viewport });
        await task.promise;
        if (!cancelled) {
          setIsRendering(false);
          onRenderedRef.current?.();
        }
      } catch (error) {
        if (cancelled || isRenderCancelled(error)) return;
        setIsRendering(false);
        onErrorRef.current(error instanceof Error ? `Could not render the PDF: ${error.message}` : "Could not render the PDF.");
      }
    })();

    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [url, page, containerWidth]);

  // Draw evidence first, then cited, then the active highlight on top.
  const order: Record<HighlightKind, number> = { evidence: 0, cited: 1, active: 2 };
  const sorted = [...highlights].sort((a, b) => order[a.kind] - order[b.kind]);

  return (
    <div
      ref={containerRef}
      className={`relative shrink-0 bg-white shadow-md ring-1 ring-slate-200 ${ZOOM_WIDTH_CLASSES[zoomIndex] ?? "w-full"}`}
    >
      <canvas ref={canvasRef} className="block h-auto w-full" />
      <svg
        className={`absolute inset-0 h-full w-full ${isRendering ? "invisible" : ""}`}
        viewBox={`0 0 ${pageWidth} ${pageHeight}`}
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        {sorted.map((highlight) =>
          highlight.rects.map((rect, i) => (
            <rect
              key={`${highlight.id}-${i}`}
              data-highlight={highlight.id}
              x={rect[0] - PAD}
              y={rect[1] - PAD}
              width={rect[2] - rect[0] + PAD * 2}
              height={rect[3] - rect[1] + PAD * 2}
              rx={2}
              className={`${KIND_CLASSES[highlight.kind]} cursor-pointer mix-blend-multiply transition-colors`}
              onClick={() => onHighlightClick?.(highlight.id)}
            >
              {highlight.label && <title>{highlight.label}</title>}
            </rect>
          )),
        )}
      </svg>
      {isRendering && (
        <div className="absolute inset-0 flex items-center justify-center bg-white/60">
          <Loader2 className="h-6 w-6 animate-spin text-indigo-500" aria-label="Rendering page" />
        </div>
      )}
    </div>
  );
}

export default PdfPage;
