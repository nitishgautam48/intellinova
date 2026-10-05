FROM python:3.11-slim

ARG EXTRAS=0
ARG EVAL=1
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 \
    HF_HOME=/models/hf TESSERACT_LANGS=eng+hin

# Tesseract (OCR, English + Hindi) and ffmpeg (audio/video for whisper and yt-dlp)
RUN apt-get update && apt-get install -y --no-install-recommends \
      tesseract-ocr tesseract-ocr-eng tesseract-ocr-hin ffmpeg libgl1 libglib2.0-0 curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt requirements-eval.txt requirements-extras.txt ./
# CPU-only PyTorch keeps the image small; swap the index URL for a CUDA build on GPU hosts.
RUN pip install --index-url https://download.pytorch.org/whl/cpu torch \
    && if [ "$EVAL" = "1" ]; then pip install -r requirements.txt -r requirements-eval.txt; else pip install -r requirements.txt; fi \
    && if [ "$EXTRAS" = "1" ]; then pip install -r requirements-extras.txt; fi

COPY . .
RUN useradd -m -u 1000 app && mkdir -p /data/uploads /models && chown -R app /data /models /app
USER app

EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s CMD curl -fs http://localhost:8000/api/health || exit 1
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
