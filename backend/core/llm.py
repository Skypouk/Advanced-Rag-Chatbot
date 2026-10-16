"""LLM access via the Ollama Python client, plus the evidence prompt builder."""

import logging
from functools import lru_cache
from typing import Any, Dict, Generator, List, Mapping, Optional, Sequence

import ollama

from config import Settings, get_settings
from core.evidence import EvidenceGroup

logger = logging.getLogger(__name__)

ChatMessage = Dict[str, str]

NO_ANSWER_TEXT = "I don't know based on the provided documents."

SYSTEM_PROMPT = """You are a precise assistant that answers questions using ONLY \
the evidence snippets below. Each snippet is one sentence from the user's \
documents and has an ID such as [S3].

Rules:
1. Use only facts stated in the snippets. Never use outside knowledge.
2. After every sentence of your answer, cite the snippet IDs that support it, \
in square brackets, e.g. "The fee is $20 [S2]." or "... [S1, S4]."
3. Cite only IDs that appear below, and only snippets that actually support \
the statement. Do not invent IDs.
4. If the snippets do not contain the answer, reply exactly: "{no_answer}"
5. Be concise. Use Markdown lists or tables when they help.
6. The conversation history is only for resolving references such as "it"; \
facts must still come from the snippets.

EVIDENCE:
{evidence}"""


class LLMService:
    """Thin wrapper around ``ollama.Client`` for chat completion."""

    def __init__(self, settings: Settings) -> None:
        """Create the Ollama client from settings."""
        self._settings = settings
        self._client = ollama.Client(
            host=settings.OLLAMA_BASE_URL,
            timeout=settings.OLLAMA_REQUEST_TIMEOUT,
        )

    @property
    def model(self) -> str:
        """Return the configured chat model name."""
        return self._settings.OLLAMA_LLM_MODEL

    @staticmethod
    def format_evidence(groups: Sequence[EvidenceGroup]) -> str:
        """Render evidence as passages of consecutive, individually-labelled sentences."""
        blocks = []
        for group in groups:
            first, last = group.snippets[0].page, group.snippets[-1].page
            pages = f"p. {first}" if first == last else f"pp. {first}-{last}"
            lines = "\n".join(f"[{s.id}] {s.text}" for s in group.snippets)
            blocks.append(f"From \"{group.filename}\" ({pages}):\n{lines}")
        return "\n\n".join(blocks) if blocks else "(no evidence)"

    def build_prompt(
        self,
        query: str,
        evidence: Sequence[EvidenceGroup],
        chat_history: Optional[List[Mapping[str, str]]] = None,
    ) -> List[ChatMessage]:
        """Build the chat messages sent to the LLM.

        Args:
            query: The user's current question.
            evidence: Labelled evidence passages.
            chat_history: Prior ``{"role", "content"}`` messages; only the last
                ``MAX_CHAT_HISTORY`` are kept.

        Returns:
            A list of Ollama chat messages (system, history..., user).
        """
        system = SYSTEM_PROMPT.format(no_answer=NO_ANSWER_TEXT, evidence=self.format_evidence(evidence))
        messages: List[ChatMessage] = [{"role": "system", "content": system}]

        history = [
            {"role": str(m["role"]), "content": str(m["content"])}
            for m in (chat_history or [])
            if m.get("role") in ("user", "assistant") and str(m.get("content", "")).strip()
        ]
        max_history = self._settings.MAX_CHAT_HISTORY
        if max_history > 0:
            messages.extend(history[-max_history:])

        messages.append({"role": "user", "content": f"{query}\n\n(Answer only from the evidence and cite snippet IDs.)"})
        return messages

    def _options(self) -> Dict[str, Any]:
        """Return generation options passed to Ollama."""
        return {"temperature": self._settings.OLLAMA_TEMPERATURE}

    def generate_stream(self, messages: List[ChatMessage]) -> Generator[str, None, None]:
        """Stream the model's reply token by token."""
        stream = self._client.chat(model=self.model, messages=messages, stream=True, options=self._options())
        for chunk in stream:
            content = chunk["message"]["content"]
            if content:
                yield content

    def generate(self, messages: List[ChatMessage]) -> str:
        """Return the model's complete reply as a single string."""
        response = self._client.chat(model=self.model, messages=messages, stream=False, options=self._options())
        return response["message"]["content"]

    def ping(self) -> bool:
        """Return True if the Ollama server is reachable."""
        try:
            self._client.list()
            return True
        except Exception as exc:  # noqa: BLE001
            logger.warning("Ollama health check failed: %s", exc)
            return False


@lru_cache(maxsize=1)
def get_llm_service() -> LLMService:
    """Return the singleton LLMService (FastAPI dependency)."""
    return LLMService(settings=get_settings())
