# Medoro AI service (optional server voice): Kokoro-82M + Faster-Whisper + client for Ollama. Used by deploy/office (profile "ai").
FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 HF_HOME=/models/huggingface HF_HUB_OFFLINE=1 \
    TTS_ENGINE=kokoro KOKORO_VOICE=hf_alpha OMP_NUM_THREADS=2 MKL_NUM_THREADS=2 MALLOC_ARENA_MAX=2 TTS_LEXICON_PATH=/models/lexicon.json
# VOICE_ONLY=1 (deploy/voice): just the voice, no ffmpeg (no speech recognition on this machine).
ARG VOICE_ONLY=0
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates $([ "$VOICE_ONLY" = "1" ] || echo ffmpeg) && rm -rf /var/lib/apt/lists/*
WORKDIR /srv
COPY requirements*.txt ./
# Slow or unsteady internet: wait longer and retry instead of failing the build. torch is the CPU-only build.
RUN pip install --no-cache-dir --default-timeout=180 --retries 10 -r $([ "$VOICE_ONLY" = "1" ] && echo requirements-voice.txt || echo requirements.txt)
COPY app ./app
COPY scripts ./scripts
RUN chmod +x scripts/fetch-models.sh && useradd --system --home /srv medoro && mkdir -p /models && chown medoro /models
USER medoro
VOLUME ["/models"]
EXPOSE 8090
# Downloads Kokoro (and warms Whisper) into the /models volume on first start, then serves.
CMD ["sh", "-c", "scripts/fetch-models.sh && exec uvicorn app.main:app --host 0.0.0.0 --port 8090 --workers 1 --no-access-log --timeout-graceful-shutdown 20"]
