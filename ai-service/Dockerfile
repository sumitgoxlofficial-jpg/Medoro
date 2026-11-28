# Medoro AI service (optional server voice): Faster-Whisper + Piper + client for Ollama. Used by deploy/office (profile "ai").
FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 HF_HOME=/models/huggingface PIPER_VOICE=/models/voices/hi_IN-priyamvada-medium.onnx
# VOICE_ONLY=1 (deploy/voice): just the voice, half the download, no ffmpeg (no speech recognition on this machine).
ARG VOICE_ONLY=0
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates $([ "$VOICE_ONLY" = "1" ] || echo ffmpeg) && rm -rf /var/lib/apt/lists/*
WORKDIR /srv
COPY requirements*.txt ./
# Slow or unsteady internet: wait longer and retry instead of failing the build.
RUN pip install --no-cache-dir --default-timeout=180 --retries 10 -r $([ "$VOICE_ONLY" = "1" ] && echo requirements-voice.txt || echo requirements.txt)
COPY app ./app
COPY scripts/fetch-models.sh /usr/local/bin/fetch-models
RUN chmod +x /usr/local/bin/fetch-models && useradd --system --home /srv medoro && mkdir -p /models && chown medoro /models
USER medoro
VOLUME ["/models"]
EXPOSE 8090
# Downloads the voice (and warms Whisper) into the /models volume on first start, then serves.
CMD ["sh", "-c", "fetch-models && exec uvicorn app.main:app --host 0.0.0.0 --port 8090 --workers 1 --no-access-log"]
