# 📚 RAG Chatbot: sentence-level answers with highlighted sources, 100% local

Upload PDF, DOCX or TXT files and ask questions about them. Every answer cites the **exact sentences** it is based on. Click a citation and the original document opens next to the chat, scrolled to the cited sentences, which are highlighted on the page.

Everything is **free, open source and runs on your machine**. No API keys, and nothing leaves your computer.

| Layer          | Technology                                                                                       |
| -------------- | ------------------------------------------------------------------------------------------------ |
| LLM            | [Ollama](https://ollama.com) running `llama3` (configurable)                                      |
| Embeddings     | `nomic-embed-text` via Ollama, one vector **per sentence**                                        |
| Vector store   | ChromaDB (persistent, on disk)                                                                    |
| Extraction     | PyMuPDF (PDF text and word boxes) · Docling (DOCX, and OCR for scanned PDFs) · python-docx fallback |
| Segmentation   | Punctuation-based sentence splitter with exact character offsets                                  |
| Backend        | FastAPI + LangChain, SSE streaming, Pydantic v2                                                   |
| Frontend       | React 18 + Vite + TypeScript + TailwindCSS + Lucide + pdf.js                                      |
| Infrastructure | Docker Compose (3 services)                                                                       |

---

## How it works

```
 INGEST   file ─▶ extract pages ─▶ split into sentences ─▶ embed each sentence ─▶ ChromaDB
                  (text + word boxes)  (page, start, end,                          (vectors)
                                        highlight rects)  ──────────────────────▶ document store
                                                                                   (original file,
                                                                                    page text, offsets)

 ASK      question ─▶ embed ─▶ top-k similar sentences ─▶ + neighbours (±1) ─▶ label S1…Sn
                                                                                   │
          ◀── SSE: sources (with locations + deep links) ◀─────────────────────────┤
          ◀── SSE: tokens  "The fee is $20 [S2]."  ◀── LLM answers only from S1…Sn ┘
          ◀── SSE: citations ["S2", …]

 VIEW     click [S2] ─▶ viewer loads the page ─▶ draws the sentence's rectangles on the
                        rendered PDF (or marks the character range in DOCX/TXT text)
```

1. **Sentence splitting.** Each page is split on terminal punctuation (`. ! ? …` and `。！？`) and on paragraph breaks. Common abbreviations (`Dr.`, `e.g.`, `U.S.`, `Jan.`), initials and decimals are not treated as sentence ends. Over-long sentences are split further on `; : ,`. Every sentence keeps its page number, its `[start, end)` character offsets in the page text and, for PDFs, the rectangles that cover it (one per line).
2. **Embedding.** Every sentence is embedded separately, using nomic's `search_document:` / `search_query:` task prefixes.
3. **Retrieval and evidence.** The `RETRIEVAL_TOP_K` most similar sentences are retrieved and widened with `EVIDENCE_WINDOW` neighbours on each side. The neighbours give context for words like "it" or "this", and each still has its own ID. The resulting snippets are labelled `S1…Sn` in reading order.
4. **Grounded answer.** The LLM gets the question and the labelled snippets, with instructions to answer **only** from them and to cite IDs after every sentence (`[S2]`, `[S1, S4]`). When the answer is not in the snippets, it says "I don't know".
5. **Source links.** The backend parses the cited IDs from the answer and sends them in a `citations` event. Every snippet carries `doc_id`, `page`, `start`, `end`, `rects` and a deep link such as `/?doc=…&page=3&hl=120-188#S2`.
6. **Viewer.** PDFs render with pdf.js, and highlight rectangles are drawn in PDF coordinates on top of the page, so they line up at any zoom level. DOCX and TXT files show their extracted text with the sentence ranges marked.

**Highlight colours:** 🟧 the sentence you clicked · 🟨 sentences cited by the answer · 🟦 other evidence given to the model.

**Highlight accuracy by format:**

| Format | Viewer | Highlight |
| ------ | ------ | --------- |
| PDF with a text layer | Original page (pdf.js) | Exact sentence, one box per line |
| Scanned PDF (no text layer) | Original page | Docling OCR runs instead; the box covers the paragraph containing the sentence |
| DOCX | Extracted text, in parts of about 4,000 characters | Exact sentence |
| TXT | Text, in parts of about 4,000 characters | Exact sentence |

---

## Quick start (Docker)

### Prerequisites

- [Docker](https://docs.docker.com/get-docker/) with Docker Compose v2.24+ (Docker Desktop on Windows/macOS)
- About 10 GB of free disk space (models plus images) and at least 8 GB of RAM
- Optional: an NVIDIA GPU with `nvidia-container-toolkit`. See [GPU acceleration](#gpu-acceleration).

### Run

```bash
cd rag-chatbot
cp .env.example .env        # optional – defaults work out of the box
docker-compose up --build
```

> **The first start takes a while.** The `ollama` service downloads `llama3` (about 4.7 GB) and `nomic-embed-text` (about 270 MB). The backend image also installs Docling and its models. The backend only starts once Ollama reports healthy, which means both models are present.

### Open

| URL                              | What                           |
| -------------------------------- | ------------------------------ |
| http://localhost:5173            | Chat UI                        |
| http://localhost:8000/docs       | Interactive API docs (Swagger) |
| http://localhost:8000/api/health | Health check                   |

### Use

1. Drag a PDF, DOCX or TXT file (max 50 MB) onto the upload zone in the sidebar.
2. Ask a question. The answer streams in with citation chips such as <kbd>S2</kbd>.
3. When the answer finishes, the source viewer opens on the first cited sentence. Click any chip or source card to jump to that sentence. Use the 🔗 button to copy a deep link to the highlighted sentence.

Data persists in `backend/chroma_db/` (sentence vectors) and `backend/document_store/` (original files, page text and sentence locations).

> **Upgrading from the chunk-based version?** Indexes from before this version have no sentence locations. Re-upload your documents. The new index uses a separate collection (`rag_sentences`), so the old data does not interfere.

---

## Configuration

All backend settings come from environment variables, set either in `.env` or in your shell:

| Variable                 | Default                  | Description |
| ------------------------ | ------------------------ | ----------- |
| `OLLAMA_BASE_URL`        | `http://localhost:11434` | Ollama server (Compose forces `http://ollama:11434`) |
| `OLLAMA_LLM_MODEL`       | `llama3`                 | Chat model |
| `OLLAMA_EMBED_MODEL`     | `nomic-embed-text`       | Embedding model |
| `OLLAMA_TEMPERATURE`     | `0.1`                    | Sampling temperature |
| `OLLAMA_REQUEST_TIMEOUT` | `300`                    | Seconds before an Ollama request times out |
| `EMBED_DOCUMENT_PREFIX` / `EMBED_QUERY_PREFIX` | auto | Task prefixes; applied automatically for nomic models. Set to `""` to disable |
| `CHROMA_PERSIST_DIR`     | `./chroma_db`            | Vector store directory |
| `CHROMA_COLLECTION`      | `rag_sentences`          | Collection name |
| `DOCUMENT_STORE_DIR`     | `./document_store`       | Original files, page text and sentence offsets |
| `MAX_SENTENCE_CHARS`     | `600`                    | Longer sentences are split on `; : ,` |
| `TEXT_PAGE_CHARS`        | `4000`                   | Size of a viewer "part" for DOCX/TXT |
| `RETRIEVAL_TOP_K`        | `8`                      | Sentences retrieved per question |
| `EVIDENCE_WINDOW`        | `1`                      | Neighbouring sentences added on each side of a hit (`0` sends isolated sentences) |
| `MAX_CHAT_HISTORY`       | `6`                      | Previous messages sent to the LLM (citation markers are removed) |
| `MAX_UPLOAD_SIZE_MB`     | `50`                     | Upload size limit |
| `MAX_QUERY_LENGTH`       | `4000`                   | Max characters per question |
| `CORS_ORIGINS`           | `http://localhost:5173,http://127.0.0.1:5173` | Allowed origins |
| `FRONTEND_URL`           | `http://localhost:5173`  | Base URL used to build absolute deep links |

Frontend (Vite):

| Variable            | Default                 | Description |
| ------------------- | ----------------------- | ----------- |
| `VITE_PROXY_TARGET` | `http://localhost:8000` | Where the dev server proxies `/api` (Compose: `http://backend:8000`) |
| `VITE_API_BASE_URL` | `""` (relative)         | Set this only to call the backend directly without the proxy |

### Changing the model

Set `OLLAMA_LLM_MODEL` in `.env`, for example `llama3.1:8b`, `mistral`, `qwen2.5:7b` or `phi3`, then run `docker-compose up -d --force-recreate ollama backend`. Larger instruction-tuned models follow the citation format more reliably.

> If you change `OLLAMA_EMBED_MODEL`, delete `backend/chroma_db/*` and `backend/document_store/*` and re-upload your documents.

### GPU acceleration

Uncomment the `deploy:` block under the `ollama` service in `docker-compose.yml`.

---

## Running without Docker

You will need Python 3.11+, Node 20+ and [Ollama](https://ollama.com/download).

```bash
ollama pull llama3 && ollama pull nomic-embed-text

cd rag-chatbot/backend
python -m venv .venv && source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000

cd ../frontend              # new terminal
npm install && npm run dev  # http://localhost:5173
```

---

## API reference

All errors use the same shape: `{ "detail": "human readable message" }`.

### `POST /api/upload`

`multipart/form-data` with a `file` field. Add `?replace=true` to overwrite an existing document with the same name.

```json
{ "filename": "handbook.pdf", "doc_id": "7d5635e92435ecb0", "chunks_indexed": 412, "pages": 12,
  "status": "success", "message": "'handbook.pdf' indexed successfully (412 sentences, 12 pages)." }
```

`chunks_indexed` is the number of indexed sentences. Status codes: 201 indexed · 400 empty file · 409 duplicate (retry with `replace=true`) · 413 larger than 50 MB · 415 wrong type · 422 no extractable text · 502 embedding model error · 503 Ollama unreachable. Embedding happens before anything is written, so a failed replace keeps the previous version.

### `POST /api/chat` (Server-Sent Events)

```bash
curl -N -X POST http://localhost:8000/api/chat -H "Content-Type: application/json" \
  -d '{"query": "What is the refund window?", "chat_history": []}'
```

Events arrive in this order: `sources` → `token`… → `citations` → `done`. If something fails, the stream sends `error` and then `done`.

```
data: {"type": "sources", "content": [{
         "id": "S2", "doc_id": "7d5635e92435ecb0", "filename": "policy.pdf", "file_type": "pdf",
         "page": 1, "sentence_index": 1, "start": 14, "end": 72,
         "text": "Customers may request a refund within 30 days of purchase.",
         "rects": [[72.0, 104.5, 368.52, 119.61]], "page_width": 595.0, "page_height": 842.0,
         "score": 0.83, "is_hit": true,
         "link": "http://localhost:5173/?doc=7d5635e92435ecb0&page=1&hl=14-72#S2" }, …]}

data: {"type": "token", "content": "Refunds are possible within 30 days [S2]."}

data: {"type": "citations", "content": ["S2"]}

data: {"type": "done", "content": ""}
```

`rects` are `[x0, y0, x1, y1]` in PDF points with a top-left origin, for the page as displayed (rotation applied). `is_hit` is `false` for neighbouring context sentences.

### `GET /api/documents`

```json
{ "documents": [{ "filename": "policy.pdf", "chunk_count": 10, "doc_id": "7d5635e92435ecb0",
                  "file_type": "pdf", "page_count": 2, "version": "2026-10-07T10:02:00+00:00" }] }
```

### `GET /api/documents/{doc_id}/pages/{n}`

Returns page `n`'s exact text, its size and every sentence on it as `{index, start, end, rects}`. The viewer uses it to resolve highlights.

### `GET /api/documents/{doc_id}/file`

Serves the original uploaded file inline.

### `DELETE /api/documents/{filename}`

Deletes the sentence vectors, the stored text and the original file. Returns 404 if the document is unknown.

### `GET /api/health`

`{ "status": "ok" | "degraded", "ollama": bool, "chromadb": bool }`

### Deep links

`http://localhost:5173/?doc=<doc_id>&page=<n>&hl=<start>-<end>#<label>` opens the viewer on page `n` with characters `start` to `end` highlighted. Every snippet's `link` field uses this format.

---

## Project structure

```
rag-chatbot/
├── docker-compose.yml
├── backend/
│   ├── main.py                 FastAPI app, CORS, error handlers, /api/health
│   ├── config.py               Settings from environment variables
│   ├── core/
│   │   ├── extractor.py        Pages + word boxes (PyMuPDF), Docling, python-docx
│   │   ├── chunker.py          Sentence segmentation with offsets and rectangles
│   │   ├── embedder.py         OllamaEmbeddings with nomic task prefixes
│   │   ├── vectorstore.py      ChromaDB: one record per sentence
│   │   ├── document_store.py   Original files, page text, sentence locations
│   │   ├── evidence.py         Retrieval expansion, snippet IDs, citation parsing
│   │   └── llm.py              Evidence prompt + Ollama streaming
│   └── api/routes/             upload.py · chat.py · documents.py
└── frontend/src/
    ├── api/client.ts           HTTP + SSE calls
    ├── lib/                    citations.ts (chips, deep links) · pdf.ts (lazy pdf.js)
    ├── hooks/                  useChat.ts · useDocuments.ts
    ├── components/             ChatWindow, ChatInput, MessageBubble, SourceCard,
    │   │                       DocumentUpload, DocumentList, Sidebar, DocumentViewer
    │   └── viewer/             PdfPage (canvas + SVG highlights) · TextPage
    └── types/index.ts
```

---

## Troubleshooting

| Symptom | Fix |
| ------- | --- |
| `backend` waits forever | The models are still downloading. Check `docker-compose logs -f ollama`. |
| Header shows **Degraded** | Run `docker exec rag-ollama ollama list` and check that both models are present. |
| Answer has no citation chips | Small models sometimes ignore the citation format. Use a larger or instruction-tuned model, or lower `OLLAMA_TEMPERATURE`. Retrieved sentences are still listed under the answer. |
| A chip is shown struck through | The model cited an ID that was not in the evidence. It is ignored. |
| Highlight covers a whole paragraph | The PDF has no text layer, so OCR was used. Re-export the PDF with selectable text for exact boxes. |
| Upload fails with 422 | No text could be extracted (for example, an image-only file that OCR couldn't read). |
| Viewer shows "Showing the extracted text instead" | pdf.js could not render the file. Highlights are still exact on the text view. |
| Hot reload doesn't trigger on Windows/macOS | Polling is already enabled. Make sure the project is on a drive that Docker Desktop shares. |

---

## License

MIT. Every component used (Ollama, Llama 3 community license, ChromaDB, LangChain, Docling, PyMuPDF (AGPL), pdf.js, FastAPI, React) is free to use locally.
