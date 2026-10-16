FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    HF_HOME=/opt/hf_cache

# System libraries needed by Docling (OpenCV / layout models) + curl for healthchecks
RUN apt-get update \
    && apt-get install -y --no-install-recommends libgl1 libglib2.0-0 curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install CPU-only PyTorch first so Docling doesn't pull the multi-GB CUDA build
RUN pip install --index-url https://download.pytorch.org/whl/cpu torch torchvision

COPY requirements.txt .
RUN pip install -r requirements.txt

# Pre-download Docling's layout/table models so the first upload is not slow.
# Non-fatal: if this fails, Docling downloads them lazily on first use.
RUN docling-tools models download || echo "Docling model prefetch skipped"

COPY . .

RUN mkdir -p /app/chroma_db /app/document_store

EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
