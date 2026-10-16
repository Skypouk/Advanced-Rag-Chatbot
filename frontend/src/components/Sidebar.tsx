import { Library, X } from "lucide-react";

import type { Document, UploadResult, UploadStatus } from "../types";
import { DocumentList } from "./DocumentList";
import { DocumentUpload } from "./DocumentUpload";

interface SidebarProps {
  /** Whether the drawer is open (mobile only; always visible on desktop). */
  isOpen: boolean;
  onClose: () => void;
  documents: Document[];
  isLoading: boolean;
  listError: string | null;
  uploadStatus: UploadStatus;
  deletingFilename: string | null;
  onUpload: (file: File, replace?: boolean) => Promise<UploadResult>;
  onDelete: (filename: string) => Promise<boolean>;
  onRefresh: () => void;
  onResetUploadStatus: () => void;
}

/**
 * Document management panel: upload zone + indexed document list.
 * Renders as a slide-in drawer on mobile and a fixed column on desktop.
 */
export function Sidebar({
  isOpen,
  onClose,
  documents,
  isLoading,
  listError,
  uploadStatus,
  deletingFilename,
  onUpload,
  onDelete,
  onRefresh,
  onResetUploadStatus,
}: SidebarProps) {
  const totalSentences = documents.reduce((sum, doc) => sum + doc.chunk_count, 0);

  return (
    <>
      {/* Backdrop (mobile only) */}
      <div
        className={`fixed inset-0 z-30 bg-slate-900/40 transition-opacity md:hidden ${
          isOpen ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
        onClick={onClose}
        aria-hidden="true"
      />

      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-80 max-w-[85vw] flex-col border-r border-slate-200 bg-white transition-transform duration-200 md:static md:z-auto md:max-w-none md:translate-x-0 ${
          isOpen ? "translate-x-0" : "-translate-x-full"
        }`}
        aria-label="Documents"
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <div className="flex items-center gap-2">
            <Library className="h-4 w-4 text-indigo-600" aria-hidden="true" />
            <h2 className="text-sm font-semibold text-slate-800">Documents</h2>
            <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-semibold text-indigo-700">
              {documents.length}
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-slate-500 hover:bg-slate-100 md:hidden"
            aria-label="Close sidebar"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4">
          <DocumentUpload uploadStatus={uploadStatus} onUpload={onUpload} onResetStatus={onResetUploadStatus} />

          <div>
            <div className="mb-2 flex items-baseline justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Indexed files</h3>
              {documents.length > 0 && (
                <span className="text-[11px] text-slate-400">
                  {documents.length} file{documents.length === 1 ? "" : "s"} · {totalSentences} sentences
                </span>
              )}
            </div>
            <DocumentList
              documents={documents}
              isLoading={isLoading}
              error={listError}
              deletingFilename={deletingFilename}
              onDelete={onDelete}
              onRefresh={onRefresh}
            />
          </div>
        </div>

        <div className="border-t border-slate-200 px-4 py-2.5 text-[11px] text-slate-400">
          100% local · Ollama + ChromaDB
        </div>
      </aside>
    </>
  );
}

export default Sidebar;
