# Medoro AI service (optional server voice): Faster-Whisper + Piper + client for Ollama. Used by deploy/office (profile "ai").
FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 HF_HOME=/models/huggingface PIPER_VOICE=/models/voices/hi_IN-priyamvada-medium.onnx
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg curl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /srv
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app ./app
COPY scripts/fetch-models.sh /usr/local/bin/fetch-models
RUN chmod +x /usr/local/bin/fetch-models && useradd --system --home /srv medoro && mkdir -p /models && chown medoro /models
USER medoro
VOLUME ["/models"]
EXPOSE 8090
# Downloads the voice (and warms Whisper) into the /models volume on first start, then serves.
CMD ["sh", "-c", "fetch-models && exec uvicorn app.main:app --host 0.0.0.0 --port 8090 --workers 1 --no-access-log"]
