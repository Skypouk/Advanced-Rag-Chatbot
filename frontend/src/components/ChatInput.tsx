import { Loader2, SendHorizontal, Square, X } from "lucide-react";
import type { ChangeEvent, FormEvent, KeyboardEvent } from "react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { MAX_QUERY_LENGTH } from "../hooks/useChat";

// The textarea shows at most 5 lines: leading-6 (1.5rem) × 5 + py-1.5 (0.75rem) = max-h-[8.25rem].

interface ChatInputProps {
  /** Send the message; returns `false` if it was rejected. */
  onSend: (message: string) => boolean;
  /** Stop the current streaming answer. */
  onStop: () => void;
  isStreaming: boolean;
  /** Validation message coming from the chat hook. */
  validationError?: string | null;
  placeholder?: string;
}

/**
 * Auto-growing chat input with Enter-to-send, Shift+Enter for a new line,
 * a character counter, a clear button and empty-query validation.
 */
export function ChatInput({ onSend, onStop, isStreaming, validationError, placeholder }: ChatInputProps) {
  const [value, setValue] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const length = value.length;
  const overLimit = length > MAX_QUERY_LENGTH;
  const error = localError ?? validationError ?? null;

  /**
   * Grow the textarea with its content. The `max-h-[8.25rem]` class caps it
   * at 5 lines, after which `overflow-y-auto` makes it scroll.
   */
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);

  // Re-focus the input once streaming finishes.
  useEffect(() => {
    if (!isStreaming) textareaRef.current?.focus();
  }, [isStreaming]);

  /** Validate and submit the current text. */
  const submit = (): void => {
    if (isStreaming) return;
    if (!value.trim()) {
      setLocalError("Please enter a question before sending.");
      return;
    }
    if (overLimit) {
      setLocalError(`Your question is too long (max ${MAX_QUERY_LENGTH} characters).`);
      return;
    }
    if (onSend(value)) {
      setValue("");
      setLocalError(null);
    }
  };

  /** Handle form submission (send button). */
  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    submit();
  };

  /** Enter sends; Shift+Enter inserts a newline. */
  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      submit();
    }
  };

  /** Update the text and clear any validation error. */
  const handleChange = (event: ChangeEvent<HTMLTextAreaElement>): void => {
    setValue(event.target.value);
    if (localError) setLocalError(null);
  };

  /** Clear the input and focus it. */
  const handleClear = (): void => {
    setValue("");
    setLocalError(null);
    textareaRef.current?.focus();
  };

  return (
    <form onSubmit={handleSubmit} className="w-full">
      <div
        className={`flex items-end gap-2 rounded-2xl border bg-white p-2 shadow-sm transition-colors focus-within:ring-2 ${
          error || overLimit
            ? "border-red-300 focus-within:ring-red-100"
            : "border-slate-300 focus-within:border-indigo-400 focus-within:ring-indigo-100"
        }`}
      >
        <textarea
          ref={textareaRef}
          value={value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          disabled={isStreaming}
          rows={1}
          placeholder={placeholder ?? "Ask a question about your documents…"}
          aria-label="Message"
          aria-invalid={Boolean(error) || overLimit}
          className="max-h-[8.25rem] min-h-[2.25rem] flex-1 resize-none overflow-y-auto bg-transparent px-2 py-1.5 text-sm leading-6 text-slate-800 placeholder:text-slate-400 focus:outline-none disabled:cursor-not-allowed disabled:text-slate-400"
        />

        {value.length > 0 && !isStreaming && (
          <button
            type="button"
            onClick={handleClear}
            className="mb-0.5 rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            aria-label="Clear input"
            title="Clear"
          >
            <X className="h-4 w-4" />
          </button>
        )}

        {isStreaming ? (
          <button
            type="button"
            onClick={onStop}
            className="mb-0.5 inline-flex items-center gap-1.5 rounded-xl bg-slate-800 px-3 py-2 text-sm font-medium text-white hover:bg-slate-700"
            aria-label="Stop generating"
            title="Stop generating"
          >
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            <Square className="h-3 w-3 fill-current" aria-hidden="true" />
          </button>
        ) : (
          <button
            type="submit"
            disabled={!value.trim() || overLimit}
            className="mb-0.5 rounded-xl bg-indigo-600 p-2.5 text-white transition-colors hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-slate-300"
            aria-label="Send message"
            title="Send (Enter)"
          >
            <SendHorizontal className="h-4 w-4" />
          </button>
        )}
      </div>

      <div className="mt-1.5 flex items-center justify-between px-1 text-[11px]">
        <span className={error ? "text-red-600" : "text-slate-400"} role={error ? "alert" : undefined}>
          {error ?? "Enter to send · Shift+Enter for a new line"}
        </span>
        <span className={overLimit ? "font-medium text-red-600" : "text-slate-400"}>
          {length}/{MAX_QUERY_LENGTH}
        </span>
      </div>
    </form>
  );
}

export default ChatInput;
