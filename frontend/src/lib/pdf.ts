import type { PDFDocumentProxy } from "pdfjs-dist";

/** Lazily-loaded pdf.js module (kept out of the main bundle). */
type PdfJs = typeof import("pdfjs-dist");

let pdfjsPromise: Promise<PdfJs> | null = null;
const documentCache = new Map<string, Promise<PDFDocumentProxy>>();

/** Maximum number of PDF documents kept open at once. */
const MAX_CACHED_DOCUMENTS = 4;

/**
 * Load pdf.js and configure its web worker on first use.
 *
 * @returns The pdf.js module.
 */
export function loadPdfJs(): Promise<PdfJs> {
  if (!pdfjsPromise) {
    pdfjsPromise = Promise.all([
      import("pdfjs-dist"),
      import("pdfjs-dist/build/pdf.worker.min.mjs?url"),
    ]).then(([pdfjs, worker]) => {
      pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
      return pdfjs;
    });
    pdfjsPromise.catch(() => {
      pdfjsPromise = null; // allow a retry after a failed chunk load
    });
  }
  return pdfjsPromise;
}

/**
 * Open (and cache) a PDF by URL.
 *
 * @param url - URL of the PDF; include a version query to bust the cache.
 * @returns The loaded PDF document.
 */
export function getPdfDocument(url: string): Promise<PDFDocumentProxy> {
  const cached = documentCache.get(url);
  if (cached) return cached;

  const promise = loadPdfJs().then((pdfjs) => pdfjs.getDocument({ url }).promise);
  promise.catch(() => documentCache.delete(url));
  documentCache.set(url, promise);

  // Evict the oldest documents to bound memory usage.
  while (documentCache.size > MAX_CACHED_DOCUMENTS) {
    const oldestKey = documentCache.keys().next().value;
    if (oldestKey === undefined) break;
    const oldest = documentCache.get(oldestKey);
    documentCache.delete(oldestKey);
    void oldest?.then((doc) => doc.destroy()).catch(() => undefined);
  }
  return promise;
}

/**
 * Check whether an error is pdf.js's "rendering cancelled" signal.
 *
 * @param error - The caught error.
 * @returns True if the render was cancelled on purpose.
 */
export function isRenderCancelled(error: unknown): boolean {
  return error instanceof Error && error.name === "RenderingCancelledException";
}
