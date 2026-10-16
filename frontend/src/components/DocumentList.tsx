import { AlertTriangle, FileText, FileType2, Loader2, RefreshCw, Trash2 } from "lucide-react";
import { useState } from "react";

import type { Document } from "../types";

interface DocumentListProps {
  documents: Document[];
  isLoading: boolean;
  error: string | null;
  deletingFilename: string | null;
  onDelete: (filename: string) => Promise<boolean>;
  onRefresh: () => void;
}

/**
 * Pick an icon based on the file extension.
 *
 * @param filename - Document filename.
 * @returns A Lucide icon component.
 */
function iconFor(filename: string) {
  return filename.toLowerCase().endsWith(".txt") ? FileType2 : FileText;
}

/** Placeholder rows shown while the document list loads. */
function SkeletonRows() {
  return (
    <ul className="space-y-2" aria-label="Loading documents">
      {[0, 1, 2].map((i) => (
        <li key={i} className="flex animate-pulse items-center gap-3 rounded-lg border border-slate-100 bg-white p-3">
          <div className="h-8 w-8 rounded-md bg-slate-200" />
          <div className="flex-1 space-y-1.5">
            <div className="h-3 w-3/4 rounded bg-slate-200" />
            <div className="h-2.5 w-1/3 rounded bg-slate-100" />
          </div>
        </li>
      ))}
    </ul>
  );
}

/**
 * List of indexed documents with sentence-count badges and a confirmed delete action.
 */
export function DocumentList({ documents, isLoading, error, deletingFilename, onDelete, onRefresh }: DocumentListProps) {
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

  /** Delete the document awaiting confirmation. */
  const confirmDelete = async (): Promise<void> => {
    const filename = pendingDelete;
    setPendingDelete(null);
    if (filename) await onDelete(filename);
  };

  if (isLoading) return <SkeletonRows />;

  return (
    <div>
      {error && (
        <div className="mb-2 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-2.5 text-xs text-red-700" role="alert">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span className="flex-1">{error}</span>
          <button
            type="button"
            onClick={onRefresh}
            className="inline-flex items-center gap-1 font-medium hover:underline"
          >
            <RefreshCw className="h-3 w-3" aria-hidden="true" /> Retry
          </button>
        </div>
      )}

      {documents.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-200 px-4 py-8 text-center">
          <FileText className="mx-auto h-8 w-8 text-slate-300" aria-hidden="true" />
          <p className="mt-2 text-sm text-slate-500">No documents uploaded yet</p>
        </div>
      ) : (
        <ul className="space-y-2">
          {documents.map((doc) => {
            const Icon = iconFor(doc.filename);
            const isDeleting = deletingFilename === doc.filename;
            return (
              <li
                key={doc.filename}
                className={`group flex items-center gap-3 rounded-lg border border-slate-200 bg-white p-2.5 transition-opacity ${
                  isDeleting ? "opacity-60" : ""
                }`}
              >
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-indigo-50 text-indigo-600">
                  <Icon className="h-4 w-4" aria-hidden="true" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-slate-800" title={doc.filename}>
                    {doc.filename}
                  </p>
                  <span className="mt-0.5 inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600">
                    {doc.chunk_count} sentence{doc.chunk_count === 1 ? "" : "s"} · {doc.page_count} {doc.file_type === "pdf" ? "page" : "part"}{doc.page_count === 1 ? "" : "s"}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setPendingDelete(doc.filename)}
                  disabled={isDeleting || deletingFilename !== null}
                  className="rounded-md p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:hover:bg-transparent"
                  aria-label={`Delete ${doc.filename}`}
                  title="Delete"
                >
                  {isDeleting ? (
                    <Loader2 className="h-4 w-4 animate-spin text-red-500" />
                  ) : (
                    <Trash2 className="h-4 w-4" />
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {pendingDelete && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-dialog-title"
        >
          <div className="w-full max-w-sm rounded-xl bg-white p-5 shadow-xl">
            <div className="flex items-start gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-red-100 text-red-600">
                <Trash2 className="h-5 w-5" aria-hidden="true" />
              </div>
              <div className="min-w-0">
                <h3 id="delete-dialog-title" className="text-sm font-semibold text-slate-900">
                  Delete document?
                </h3>
                <p className="mt-1 break-words text-sm text-slate-600">
                  <span className="font-medium">{pendingDelete}</span> and all its indexed sentences will be removed. This
                  cannot be undone.
                </p>
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setPendingDelete(null)}
                className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void confirmDelete()}
                className="rounded-lg bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default DocumentList;
