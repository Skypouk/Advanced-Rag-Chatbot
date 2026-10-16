import { AlertTriangle, CheckCircle2, Loader2, UploadCloud, X, XCircle } from "lucide-react";
import type { ChangeEvent, DragEvent } from "react";
import { useEffect, useRef, useState } from "react";

import { ACCEPTED_EXTENSIONS, MAX_UPLOAD_SIZE_MB } from "../hooks/useDocuments";
import type { UploadResult, UploadStatus } from "../types";

interface DocumentUploadProps {
  uploadStatus: UploadStatus;
  onUpload: (file: File, replace?: boolean) => Promise<UploadResult>;
  onResetStatus: () => void;
}

/** Tailwind width classes for the progress bar in 10% steps (no inline styles). */
const PROGRESS_WIDTHS = [
  "w-[5%]",
  "w-[10%]",
  "w-[20%]",
  "w-[30%]",
  "w-[40%]",
  "w-[50%]",
  "w-[60%]",
  "w-[70%]",
  "w-[80%]",
  "w-[90%]",
];

/** How long success/error toasts stay visible (ms). */
const TOAST_DURATION_MS = 5000;

/**
 * Drag-and-drop upload zone with progress bar, toast notifications and
 * a confirmation dialog for replacing duplicate filenames.
 */
export function DocumentUpload({ uploadStatus, onUpload, onResetStatus }: DocumentUploadProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [duplicateFile, setDuplicateFile] = useState<File | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);

  const isUploading = uploadStatus.status === "uploading";
  const progress = uploadStatus.progress ?? 0;
  const showToast = uploadStatus.status === "success" || uploadStatus.status === "error";

  // Auto-dismiss toasts.
  useEffect(() => {
    if (!showToast) return undefined;
    const timer = window.setTimeout(onResetStatus, TOAST_DURATION_MS);
    return () => window.clearTimeout(timer);
  }, [showToast, uploadStatus.message, onResetStatus]);

  /** Upload a file, opening the replace dialog if it already exists. */
  const handleFile = async (file: File, replace = false): Promise<void> => {
    const result = await onUpload(file, replace);
    if (result.duplicate) setDuplicateFile(file);
  };

  /** Handle files chosen via the file picker. */
  const handleInputChange = (event: ChangeEvent<HTMLInputElement>): void => {
    const file = event.target.files?.[0];
    event.target.value = ""; // allow re-selecting the same file
    if (file) void handleFile(file);
  };

  /** Highlight the drop zone while a file is dragged over it. */
  const handleDragEnter = (event: DragEvent<HTMLDivElement>): void => {
    event.preventDefault();
    if (isUploading) return;
    dragDepth.current += 1;
    setIsDragging(true);
  };

  /** Remove the highlight once the drag fully leaves the zone. */
  const handleDragLeave = (event: DragEvent<HTMLDivElement>): void => {
    event.preventDefault();
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setIsDragging(false);
  };

  /** Allow dropping by preventing the browser default. */
  const handleDragOver = (event: DragEvent<HTMLDivElement>): void => {
    event.preventDefault();
    event.dataTransfer.dropEffect = isUploading ? "none" : "copy";
  };

  /** Upload the first dropped file. */
  const handleDrop = (event: DragEvent<HTMLDivElement>): void => {
    event.preventDefault();
    dragDepth.current = 0;
    setIsDragging(false);
    if (isUploading) return;
    const file = event.dataTransfer.files?.[0];
    if (file) void handleFile(file);
  };

  /** Open the native file picker. */
  const openPicker = (): void => {
    if (!isUploading) inputRef.current?.click();
  };

  /** Confirm replacing the duplicate document. */
  const confirmReplace = (): void => {
    const file = duplicateFile;
    setDuplicateFile(null);
    if (file) void handleFile(file, true);
  };

  return (
    <div className="space-y-3">
      <div
        role="button"
        tabIndex={isUploading ? -1 : 0}
        aria-disabled={isUploading}
        aria-label="Upload a document"
        onClick={openPicker}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            openPicker();
          }
        }}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        className={`flex flex-col items-center justify-center rounded-xl border-2 border-dashed px-4 py-6 text-center transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300 ${
          isUploading
            ? "cursor-not-allowed border-slate-200 bg-slate-50"
            : isDragging
              ? "cursor-copy border-indigo-500 bg-indigo-50"
              : "cursor-pointer border-slate-300 bg-white hover:border-indigo-400 hover:bg-indigo-50/40"
        }`}
      >
        {isUploading ? (
          <Loader2 className="h-8 w-8 animate-spin text-indigo-500" aria-hidden="true" />
        ) : (
          <UploadCloud
            className={`h-8 w-8 ${isDragging ? "text-indigo-600" : "text-slate-400"}`}
            aria-hidden="true"
          />
        )}
        <p className="mt-2 text-sm font-medium text-slate-700">
          {isUploading ? "Processing…" : isDragging ? "Drop to upload" : "Drag & drop a file here"}
        </p>
        <p className="mt-0.5 text-xs text-slate-500">PDF, DOCX or TXT · max {MAX_UPLOAD_SIZE_MB} MB</p>
        <button
          type="button"
          disabled={isUploading}
          onClick={(event) => {
            event.stopPropagation();
            openPicker();
          }}
          className="mt-3 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white shadow-sm hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          {isUploading ? "Uploading…" : "Browse files"}
        </button>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPTED_EXTENSIONS.join(",")}
          onChange={handleInputChange}
          className="hidden"
          disabled={isUploading}
        />
      </div>

      {isUploading && (
        <div aria-live="polite">
          <div className="mb-1 flex justify-between text-xs text-slate-600">
            <span className="truncate pr-2">{uploadStatus.message}</span>
            <span>{progress < 100 ? `${progress}%` : ""}</span>
          </div>
          <div
            className="h-1.5 w-full overflow-hidden rounded-full bg-slate-200"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={progress}
          >
            <div
              className={`h-full rounded-full bg-indigo-500 transition-all duration-300 ${
                progress >= 100 ? "w-full animate-pulse" : PROGRESS_WIDTHS[Math.floor(progress / 10)]
              }`}
            />
          </div>
          {progress >= 100 && (
            <p className="mt-1 text-[11px] text-slate-500">Extracting, splitting into sentences and embedding — this may take a while.</p>
          )}
        </div>
      )}

      {showToast && (
        <div
          role={uploadStatus.status === "error" ? "alert" : "status"}
          className={`flex animate-slide-in items-start gap-2 rounded-lg border p-3 text-sm shadow-sm ${
            uploadStatus.status === "success"
              ? "border-emerald-200 bg-emerald-50 text-emerald-800"
              : "border-red-200 bg-red-50 text-red-800"
          }`}
        >
          {uploadStatus.status === "success" ? (
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          ) : (
            <XCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          )}
          <p className="flex-1 break-words">{uploadStatus.message}</p>
          <button
            type="button"
            onClick={onResetStatus}
            className="rounded p-0.5 opacity-60 hover:opacity-100"
            aria-label="Dismiss notification"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {duplicateFile && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="replace-dialog-title"
        >
          <div className="w-full max-w-sm rounded-xl bg-white p-5 shadow-xl">
            <div className="flex items-start gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-600">
                <AlertTriangle className="h-5 w-5" aria-hidden="true" />
              </div>
              <div className="min-w-0">
                <h3 id="replace-dialog-title" className="text-sm font-semibold text-slate-900">
                  Document already exists
                </h3>
                <p className="mt-1 break-words text-sm text-slate-600">
                  <span className="font-medium">{duplicateFile.name}</span> is already indexed. Replace it with the
                  new file?
                </p>
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setDuplicateFile(null)}
                className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmReplace}
                className="rounded-lg bg-amber-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-700"
              >
                Replace
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default DocumentUpload;
