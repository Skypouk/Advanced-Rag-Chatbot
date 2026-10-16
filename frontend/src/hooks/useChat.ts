import { useCallback, useEffect, useRef, useState } from "react";

import { streamChat } from "../api/client";
import type { ChatStreamHandle, Message, SourceDocument } from "../types";

/** Maximum query length accepted by the backend. */
export const MAX_QUERY_LENGTH = 4000;

/** Return value of the `useChat` hook. */
export interface UseChatResult {
  messages: Message[];
  isStreaming: boolean;
  /** Validation error for the last attempted submission, if any. */
  validationError: string | null;
  sendMessage: (query: string) => boolean;
  retryLast: () => void;
  stopStreaming: () => void;
  clearHistory: () => void;
}

/** Generate a reasonably unique id for a message. */
function createId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Chat state and SSE streaming logic.
 *
 * Keeps the conversation in state, streams the assistant reply token by
 * token, attaches retrieved sources and sends prior turns as history for
 * multi-turn context.
 *
 * @returns Chat state and actions.
 */
export function useChat(): UseChatResult {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);

  const streamRef = useRef<ChatStreamHandle | null>(null);
  // Mirror of `messages` so callbacks always read the latest conversation.
  const messagesRef = useRef<Message[]>([]);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  // Abort any open stream when the component using the hook unmounts.
  useEffect(() => () => streamRef.current?.close(), []);

  /** Apply a partial update to the message with the given id. */
  const updateMessage = useCallback((id: string, update: (message: Message) => Partial<Message>) => {
    setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, ...update(m) } : m)));
  }, []);

  /**
   * Send a question and stream the assistant's answer.
   *
   * @param rawQuery - The text typed by the user.
   * @returns `true` if the message was sent, `false` if validation failed.
   */
  const sendMessage = useCallback(
    (rawQuery: string): boolean => {
      const query = rawQuery.trim();
      if (!query) {
        setValidationError("Please enter a question before sending.");
        return false;
      }
      if (query.length > MAX_QUERY_LENGTH) {
        setValidationError(`Your question is too long (max ${MAX_QUERY_LENGTH} characters).`);
        return false;
      }
      if (streamRef.current) {
        setValidationError("Please wait for the current answer to finish.");
        return false;
      }
      setValidationError(null);

      // History: completed, successful turns only.
      const history = messagesRef.current.filter(
        (m) => !m.isStreaming && !m.error && m.content.trim().length > 0,
      );

      const userMessage: Message = {
        id: createId(),
        role: "user",
        content: query,
        timestamp: Date.now(),
      };
      const assistantId = createId();
      const assistantMessage: Message = {
        id: assistantId,
        role: "assistant",
        content: "",
        timestamp: Date.now(),
        isStreaming: true,
      };

      setMessages((prev) => [...prev, userMessage, assistantMessage]);
      setIsStreaming(true);

      /** Finalize the stream and release the handle. */
      const finalize = (update: (message: Message) => Partial<Message>): void => {
        updateMessage(assistantId, (m) => ({ ...update(m), isStreaming: false, timestamp: Date.now() }));
        streamRef.current = null;
        setIsStreaming(false);
      };

      streamRef.current = streamChat(
        query,
        history,
        (token: string) => updateMessage(assistantId, (m) => ({ content: m.content + token })),
        (sources: SourceDocument[]) => updateMessage(assistantId, () => ({ sources })),
        () =>
          finalize((m) =>
            m.content.trim() ? {} : { content: "", error: "No response was received from the model." },
          ),
        (error: string) => finalize(() => ({ error })),
        (citations: string[]) => updateMessage(assistantId, () => ({ citations })),
      );
      return true;
    },
    [updateMessage],
  );

  /** Abort the current stream, keeping whatever text was already received. */
  const stopStreaming = useCallback(() => {
    if (!streamRef.current) return;
    streamRef.current.close();
    streamRef.current = null;
    setIsStreaming(false);
    setMessages((prev) =>
      prev.map((m) =>
        m.isStreaming
          ? {
              ...m,
              isStreaming: false,
              error: m.content.trim() ? undefined : "Generation stopped.",
              content: m.content.trim() ? `${m.content}\n\n_(stopped)_` : m.content,
            }
          : m,
      ),
    );
  }, []);

  /** Re-send the most recent user question, replacing the failed answer. */
  const retryLast = useCallback(() => {
    if (streamRef.current) return;
    const current = messagesRef.current;
    const lastUserIndex = current.map((m) => m.role).lastIndexOf("user");
    if (lastUserIndex === -1) return;
    const query = current[lastUserIndex].content;
    const trimmed = current.slice(0, lastUserIndex);
    messagesRef.current = trimmed;
    setMessages(trimmed);
    sendMessage(query);
  }, [sendMessage]);

  /** Clear the conversation and abort any active stream. */
  const clearHistory = useCallback(() => {
    streamRef.current?.close();
    streamRef.current = null;
    messagesRef.current = [];
    setMessages([]);
    setIsStreaming(false);
    setValidationError(null);
  }, []);

  return { messages, isStreaming, validationError, sendMessage, retryLast, stopStreaming, clearHistory };
}
