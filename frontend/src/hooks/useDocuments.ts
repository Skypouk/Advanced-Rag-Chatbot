import { useCallback, useEffect, useState } from "react";

import {
  ApiError,
  deleteDocument as apiDeleteDocument,
  getErrorMessage,
  listDocuments,
  uploadDocument as apiUploadDocument,
} from "../api/client";
import type { Document, UploadResult, UploadStatus } from "../types";

/** Maximum upload size in megabytes (mirrors the backend limit). */
export const MAX_UPLOAD_SIZE_MB = 50;

/** File extensions accepted for upload. */
export const ACCEPTED_EXTENSIONS = [".pdf", ".docx", ".txt"] as const;

/** Return value of the `useDocuments` hook. */
export interface UseDocumentsResult {
  documents: Document[];
  isLoading: boolean;
  listError: string | null;
  uploadStatus: UploadStatus;
  deletingFilename: string | null;
  fetchDocuments: () => Promise<void>;
  uploadDocument: (file: File, replace?: boolean) => Promise<UploadResult>;
  deleteDocument: (filename: string) => Promise<boolean>;
  resetUploadStatus: () => void;
}

/**
 * Validate a file on the client before uploading.
 *
 * @param file - The file selected by the user.
 * @returns An error message, or `null` if the file is acceptable.
 */
export function validateFile(file: File): string | null {
  const dot = file.name.lastIndexOf(".");
  const extension = dot >= 0 ? file.name.slice(dot).toLowerCase() : "";
  if (!(ACCEPTED_EXTENSIONS as readonly string[]).includes(extension)) {
    return `Unsupported file type "${extension || "unknown"}". Please upload a PDF, DOCX or TXT file.`;
  }
  if (file.size === 0) {
    return "The selected file is empty.";
  }
  if (file.size > MAX_UPLOAD_SIZE_MB * 1024 * 1024) {
    const sizeMb = (file.size / (1024 * 1024)).toFixed(1);
    return `File is too large (${sizeMb} MB). The maximum size is ${MAX_UPLOAD_SIZE_MB} MB.`;
  }
  return null;
}

/**
 * Document upload and listing state.
 *
 * Loads the document list on mount and refreshes it automatically after
 * every successful upload or deletion.
 *
 * @returns Document state and actions.
 */
export function useDocuments(): UseDocumentsResult {
  const [documents, setDocuments] = useState<Document[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [uploadStatus, setUploadStatus] = useState<UploadStatus>({ status: "idle" });
  const [deletingFilename, setDeletingFilename] = useState<string | null>(null);

  /** Reload the list of indexed documents from the backend. */
  const fetchDocuments = useCallback(async (): Promise<void> => {
    try {
      const docs = await listDocuments();
      setDocuments(docs);
      setListError(null);
    } catch (error) {
      setListError(getErrorMessage(error));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchDocuments();
  }, [fetchDocuments]);

  /**
   * Upload and index a file.
   *
   * @param file - The file to upload.
   * @param replace - Overwrite an existing document with the same name.
   * @returns Whether the upload succeeded and whether it was a duplicate.
   */
  const uploadDocument = useCallback(
    async (file: File, replace = false): Promise<UploadResult> => {
      const validationError = validateFile(file);
      if (validationError) {
        setUploadStatus({ status: "error", message: validationError });
        return { ok: false };
      }

      setUploadStatus({ status: "uploading", progress: 0, message: `Uploading ${file.name}…` });
      try {
        const result = await apiUploadDocument(file, replace, (percent) => {
          setUploadStatus({
            status: "uploading",
            progress: percent,
            message: percent < 100 ? `Uploading ${file.name}… ${percent}%` : `Processing ${file.name}…`,
          });
        });
        setUploadStatus({ status: "success", message: result.message });
        await fetchDocuments();
        return { ok: true };
      } catch (error) {
        if (error instanceof ApiError && error.status === 409) {
          setUploadStatus({ status: "idle" });
          return { ok: false, duplicate: true };
        }
        setUploadStatus({ status: "error", message: getErrorMessage(error) });
        return { ok: false };
      }
    },
    [fetchDocuments],
  );

  /**
   * Delete a document from the knowledge base.
   *
   * @param filename - The document to delete.
   * @returns `true` on success.
   */
  const deleteDocument = useCallback(
    async (filename: string): Promise<boolean> => {
      setDeletingFilename(filename);
      try {
        await apiDeleteDocument(filename);
        await fetchDocuments();
        return true;
      } catch (error) {
        setUploadStatus({ status: "error", message: `Delete failed: ${getErrorMessage(error)}` });
        return false;
      } finally {
        setDeletingFilename(null);
      }
    },
    [fetchDocuments],
  );

  /** Reset the upload status back to idle (e.g. after a toast closes). */
  const resetUploadStatus = useCallback(() => setUploadStatus({ status: "idle" }), []);

  return {
    documents,
    isLoading,
    listError,
    uploadStatus,
    deletingFilename,
    fetchDocuments,
    uploadDocument,
    deleteDocument,
    resetUploadStatus,
  };
}
