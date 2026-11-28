"""Medoro AI service: speech to text (Faster-Whisper), text to speech (Kokoro-82M, self-hosted) and intent
classification with a local model (Ollama), behind one authenticated HTTP API for the Medoro app.

Runs on a persistent Linux host (not on Vercel). Listens on 127.0.0.1 only; Nginx terminates HTTPS in front of it.
Nothing is stored: uploaded audio is decoded from temp files that are deleted at once, no request body is logged, and
no paid or remote AI service is called.

Environment (see deploy/medoro-ai.env.example for the full list and defaults):
  MEDORO_AI_TOKEN         shared bearer token (24+ characters), the same as AI_HR_SERVICE_TOKEN in the app
  TTS_ENGINE              kokoro (default) | piper (rollback only) | off
  KOKORO_MODEL / KOKORO_LANG / KOKORO_VOICE   hexgrad/Kokoro-82M, h, hf_alpha (or hf_beta)
  TTS_SPEED, TTS_PAUSE_MS, TTS_CHUNK_CHARS, TTS_CONCURRENCY, TTS_QUEUE_MAX, TTS_TIMEOUT_S, TTS_CACHE_SIZE, TTS_CACHE_MB
  TTS_LEXICON_PATH        pronunciation fixes, re-read when the file changes (default /etc/medoro-ai/lexicon.json)
  WHISPER_MODEL / WHISPER_COMPUTE / WHISPER_THREADS / WHISPER_LANGUAGE
  OLLAMA_URL / OLLAMA_MODEL
"""
from __future__ import annotations

import asyncio
import base64
import hmac
import json
import logging
import os
import re
import resource
import tempfile
import time
from collections import OrderedDict
from contextlib import asynccontextmanager
from typing import Any, Literal

import httpx
from fastapi import Depends, FastAPI, File, Header, HTTPException, UploadFile
from pydantic import BaseModel, Field

from .tts import EngineUnavailable, Voice

VERSION = "2.0.0"
TOKEN = os.environ.get("MEDORO_AI_TOKEN", "")
WHISPER_MODEL = os.environ.get("WHISPER_MODEL", "base")
WHISPER_COMPUTE = os.environ.get("WHISPER_COMPUTE", "int8")
WHISPER_THREADS = int(os.environ.get("WHISPER_THREADS", "2"))
WHISPER_LANGUAGE = os.environ.get("WHISPER_LANGUAGE", "") or None
OLLAMA_URL = os.environ.get("OLLAMA_URL", "http://127.0.0.1:11434").rstrip("/")
OLLAMA_MODEL = os.environ.get("OLLAMA_MODEL", "medoro-hr")
MAX_AUDIO = 3_000_000
# A Hinglish prompt nudges Whisper towards romanised Hinglish instead of translating into English.
STT_PROMPT = "Haan ji, main traffic mein hoon, gyarah baje tak pahunch jaunga. Aaj leave chahiye. Checkout bhool gaya."

logging.basicConfig(level=os.environ.get("LOG_LEVEL", "INFO"), format='{"t":"%(asctime)s","level":"%(levelname)s","logger":"%(name)s","msg":"%(message)s"}')
log = logging.getLogger("medoro.ai")
VOICE = Voice()
# Lines Naina says on almost every call, made at start-up so the first calls of the day answer at once.
WARM_LINES = [
    "बताइए, मैं आपकी किस तरह मदद कर सकती हूँ?", "ठीक है, मैंने नोट कर लिया है।", "धन्यवाद! अपना ध्यान रखिए।",
    "माफ़ कीजिए, मैं ठीक से सुन नहीं पाई। क्या आप दोबारा बता सकते हैं?", "क्या अभी एक मिनट बात कर सकते हैं?",
]


async def _warm_voice() -> None:
    """Loads Kokoro once when the server starts and makes the common lines (in the background; never blocks start-up)."""
    if VOICE.engine.name == "off":
        return
    try:
        async with _tts_lock:
            await asyncio.to_thread(VOICE.engine.load)
        if os.environ.get("TTS_WARM", "1") == "1":
            for line in WARM_LINES:
                await _speak(line, None, None, "auto")
    except Exception as e:  # noqa: BLE001 - a failed warm-up is reported in /health; the next request retries
        log.warning("voice warm-up failed: %s", type(e).__name__)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    task = asyncio.get_running_loop().create_task(_warm_voice())
    yield
    task.cancel()  # graceful shutdown: stop warming, let in-flight requests finish (uvicorn waits), free the model
    VOICE.engine.unload()


app = FastAPI(title="Medoro AI service", version=VERSION, docs_url=None, redoc_url=None, openapi_url=None, lifespan=lifespan)

# One request at a time per engine on an 8 GB host: queued requests wait instead of exhausting memory.
_stt_lock = asyncio.Semaphore(1)
TTS_CONCURRENCY = max(1, int(os.environ.get("TTS_CONCURRENCY", "1")))
_tts_lock = asyncio.Semaphore(TTS_CONCURRENCY)
TTS_QUEUE_MAX = int(os.environ.get("TTS_QUEUE_MAX", "8"))
# The app asks for one sentence at a time (a few seconds each); this bounds a direct caller's long text.
TTS_TIMEOUT_S = float(os.environ.get("TTS_TIMEOUT_S", "60"))
_tts_waiting = 0
# Lines Naina says again and again are made once, then reused (bounded by entries and by megabytes).
_tts_cache: "OrderedDict[tuple, dict]" = OrderedDict()
TTS_CACHE_SIZE = int(os.environ.get("TTS_CACHE_SIZE", "100"))
TTS_CACHE_MB = float(os.environ.get("TTS_CACHE_MB", "48"))
_llm_lock = asyncio.Semaphore(1)
_whisper: Any = None


def require_token(authorization: str = Header(default="")) -> None:
    if len(TOKEN) < 24:
        raise HTTPException(503, "MEDORO_AI_TOKEN is not set (24+ characters)")
    given = authorization[7:] if authorization.lower().startswith("bearer ") else ""
    if not hmac.compare_digest(given.encode(), TOKEN.encode()):
        raise HTTPException(401, "unauthorised")


def whisper():
    global _whisper
    if _whisper is None:
        from faster_whisper import WhisperModel  # imported lazily: tests run without the model

        _whisper = WhisperModel(WHISPER_MODEL, device="cpu", compute_type=WHISPER_COMPUTE, cpu_threads=WHISPER_THREADS, num_workers=1)
    return _whisper


def memory() -> dict[str, float]:
    info: dict[str, float] = {}
    try:
        with open("/proc/meminfo") as f:
            for line in f:
                k, v = line.split(":", 1)
                if k in ("MemTotal", "MemAvailable"):
                    info[k] = int(v.strip().split()[0]) / 1024
    except OSError:
        pass
    ru = resource.getrusage(resource.RUSAGE_SELF)
    now = 0.0
    try:
        with open("/proc/self/status") as f:
            now = next((int(line.split()[1]) / 1024 for line in f if line.startswith("VmRSS:")), 0.0)
    except OSError:
        pass
    # process_rss_mb is the peak (Linux reports KB); process_rss_now_mb is the current resident size.
    return {"total_mb": round(info.get("MemTotal", 0), 1), "available_mb": round(info.get("MemAvailable", 0), 1),
            "process_rss_mb": round(ru.ru_maxrss / 1024, 1), "process_rss_now_mb": round(now, 1), "process_cpu_s": round(ru.ru_utime + ru.ru_stime, 1)}


@app.get("/health", dependencies=[Depends(require_token)])
async def health() -> dict[str, Any]:
    llm: dict[str, Any] = {"ok": False, "model": OLLAMA_MODEL}
    try:
        async with httpx.AsyncClient(timeout=3) as c:
            tags = (await c.get(f"{OLLAMA_URL}/api/tags")).json()
        names = [m.get("name", "") for m in tags.get("models", [])]
        llm["ok"] = any(n == OLLAMA_MODEL or n.startswith(OLLAMA_MODEL + ":") for n in names)
        if not llm["ok"]:
            llm["error"] = f"model {OLLAMA_MODEL} not found in Ollama"
    except Exception as e:  # noqa: BLE001 - report, don't crash the health check
        llm["error"] = f"Ollama unreachable: {type(e).__name__}"
    stt = {"ok": True, "model": f"faster-whisper {WHISPER_MODEL} {WHISPER_COMPUTE}", "loaded": _whisper is not None}
    e = VOICE.engine
    tts = {
        "ok": e.name != "off" and (e.loaded or e.error is None), "engine": e.name, "voice": VOICE.s.voice, "voices": e.voices(),
        "loaded": e.loaded, "load_ms": e.load_ms, "error": e.error, "model": VOICE.s.repo if e.name == "kokoro" else None,
        "lang": VOICE.s.lang, "speed": VOICE.s.speed, "en_mode": VOICE.s.en_mode, "sample_rate": VOICE.rate,
        "lexicon": {"terms": len(VOICE.norm.lex.terms), "words": len(VOICE.norm.lex.words), "names": len(VOICE.norm.lex.names), "overrides": VOICE.norm.lex.override_count},
        "cache": {"entries": len(_tts_cache), "max": TTS_CACHE_SIZE}, "queue": _tts_waiting, "concurrency": TTS_CONCURRENCY,
        **VOICE.stats.as_dict(),
    }
    load1 = os.getloadavg()[0] if hasattr(os, "getloadavg") else 0.0
    return {"ok": llm["ok"] and stt["ok"] and tts["ok"], "llm": llm, "stt": stt, "tts": tts, "memory": memory(), "cpu": {"count": os.cpu_count() or 0, "load1": round(load1, 2)}, "version": VERSION}


@app.post("/stt", dependencies=[Depends(require_token)])
async def stt(audio: UploadFile = File(...)) -> dict[str, Any]:
    data = await audio.read()
    if len(data) > MAX_AUDIO:
        raise HTTPException(413, "audio too long")
    if len(data) < 500:
        return {"text": "", "no_speech": True, "ms": 0}
    t0 = time.perf_counter()
    async with _stt_lock:
        text, lang, no_speech = await asyncio.to_thread(_transcribe, data)
    return {"text": text, "language": lang, "no_speech": no_speech, "ms": int((time.perf_counter() - t0) * 1000)}


def _transcribe(data: bytes) -> tuple[str, str, bool]:
    with tempfile.NamedTemporaryFile(suffix=".webm") as f:  # deleted on close; never kept
        f.write(data)
        f.flush()
        segments, info = whisper().transcribe(
            f.name, language=WHISPER_LANGUAGE, beam_size=1, best_of=1, vad_filter=True,
            vad_parameters={"min_silence_duration_ms": 500}, initial_prompt=STT_PROMPT, condition_on_previous_text=False,
        )
        parts = [s.text.strip() for s in segments if s.no_speech_prob < 0.7]
    text = " ".join(p for p in parts if p).strip()
    return text[:2000], info.language, not text


class TtsIn(BaseModel):
    text: str = Field(min_length=1, max_length=1200)
    # Optional, backward-compatible: older apps send only `text`.
    voice: str | None = Field(default=None, max_length=20)
    speed: float | None = Field(default=None, ge=0.7, le=1.3)
    lang: Literal["auto", "hi", "hinglish", "en"] = "auto"


def speakable(text: str) -> str:
    """Legacy (Piper-era) clean-up, kept for compatibility: times and short forms, removes source tags."""
    t = re.sub(r"\((Source|स्रोत):[^)]*\)", "", text)
    t = re.sub(r"\b(\d{1,2}):(\d{2})\b", lambda m: m.group(1) if m.group(2) == "00" else f"{m.group(1)} {m.group(2)}", t)
    t = re.sub(r"\bHRMS\b", "H R M S", t)
    t = re.sub(r"\bHR\b", "H R", t)
    t = re.sub(r"\bAI\b", "A I", t)
    return re.sub(r"\s+", " ", t).strip()


def _cache_put(key: tuple, value: dict) -> None:
    _tts_cache[key] = value
    limit = TTS_CACHE_MB * 1_000_000
    while len(_tts_cache) > TTS_CACHE_SIZE or (len(_tts_cache) > 1 and sum(len(v["wav"]) for v in _tts_cache.values()) > limit):
        _tts_cache.popitem(last=False)


async def _speak(text: str, voice: str | None, speed: float | None, lang: str) -> tuple[dict, bool]:
    """One synthesis at a time (TTS_CONCURRENCY), at most TTS_QUEUE_MAX waiting, each bounded by TTS_TIMEOUT_S."""
    global _tts_waiting
    key = (VOICE.engine.name, voice or VOICE.s.voice, speed or VOICE.s.speed, lang, text)
    hit = _tts_cache.get(key)
    if hit is not None:
        _tts_cache.move_to_end(key)
        VOICE.stats.cache_hits += 1
        return hit, True
    if _tts_waiting >= TTS_QUEUE_MAX:
        raise HTTPException(503, "voice busy, try again")
    _tts_waiting += 1
    try:
        await asyncio.wait_for(_tts_lock.acquire(), TTS_TIMEOUT_S)
    except asyncio.TimeoutError as e:
        raise HTTPException(504, "voice busy, timed out") from e
    finally:
        _tts_waiting -= 1
    # The thread can't be cancelled, so the slot is freed only when it really finishes (never two at once).
    fut = asyncio.ensure_future(asyncio.to_thread(VOICE.render, text, voice, speed, lang))
    fut.add_done_callback(lambda _f: _tts_lock.release())
    try:
        out = await asyncio.wait_for(asyncio.shield(fut), TTS_TIMEOUT_S)
    except asyncio.TimeoutError as e:
        raise HTTPException(504, "voice timed out") from e
    _cache_put(key, out)
    return out, False


@app.post("/tts", dependencies=[Depends(require_token)])
async def tts(body: TtsIn) -> dict[str, Any]:
    VOICE.stats.requests += 1
    t0 = time.perf_counter()
    try:
        out, hit = await _speak(body.text, body.voice, body.speed, body.lang)
    except ValueError as e:
        raise HTTPException(422, "nothing to say") from e
    except EngineUnavailable as e:
        raise HTTPException(503, "voice unavailable") from e
    ms = int((time.perf_counter() - t0) * 1000)
    log.info("tts ms=%d cached=%s chunks=%d speech_chars=%d audio_ms=%d rss_mb=%.0f", ms, hit, out["chunks"], out["speech_chars"], out["duration_ms"], memory()["process_rss_now_mb"])
    return {"audio_b64": base64.b64encode(out["wav"]).decode(), "mime": "audio/wav", "ms": ms, "cached": hit,
            "engine": VOICE.engine.name, "voice": out["voice"], "lang": out["lang"], "chunks": out["chunks"],
            "duration_ms": out["duration_ms"], "sample_rate": VOICE.rate}


class ClassifyIn(BaseModel):
    utterance: str = Field(min_length=1, max_length=500)
    call_reason: str = Field(max_length=30)
    question: str = Field(default="", max_length=300)
    intents: list[str] = Field(min_length=1, max_length=30)


CLASSIFY_PROMPT = """Classify what an employee said to an HR assistant into exactly one intent from this list: {intents}.
The assistant had asked about: {reason} ({question}).
Rules: choose "unknown" if unsure. Never guess a time; set eta only if the employee said a clear clock time (24-hour HH:MM, India time), else null.
Reply with JSON only: {{"intent": "...", "eta": null}}.
Employee said: {utterance}"""


@app.post("/llm/classify", dependencies=[Depends(require_token)])
async def classify(body: ClassifyIn) -> dict[str, Any]:
    allowed = set(body.intents)
    prompt = CLASSIFY_PROMPT.format(intents=", ".join(sorted(allowed)), reason=body.call_reason, question=body.question or "the call's question", utterance=body.utterance)
    t0 = time.perf_counter()
    async with _llm_lock:
        try:
            async with httpx.AsyncClient(timeout=20) as c:
                r = await c.post(f"{OLLAMA_URL}/api/chat", json={
                    "model": OLLAMA_MODEL, "stream": False, "format": "json", "keep_alive": "5m",
                    "options": {"temperature": 0, "num_predict": 40, "num_ctx": 1024},
                    "messages": [{"role": "user", "content": prompt}],
                })
            r.raise_for_status()
            content = r.json().get("message", {}).get("content", "{}")
        except Exception as e:  # noqa: BLE001
            raise HTTPException(503, f"local model unavailable: {type(e).__name__}") from e
    return {**validate_classification(content, allowed), "ms": int((time.perf_counter() - t0) * 1000)}


def validate_classification(content: str, allowed: set[str]) -> dict[str, Any]:
    """The model's answer is only used if it is valid JSON naming an allowed intent; anything else is 'unknown'."""
    try:
        data = json.loads(content)
    except (ValueError, TypeError):
        return {"intent": "unknown", "eta": None}
    intent = data.get("intent") if isinstance(data, dict) else None
    eta = data.get("eta") if isinstance(data, dict) else None
    if intent not in allowed:
        intent = "unknown"
    if not (isinstance(eta, str) and re.fullmatch(r"([01]\d|2[0-3]):[0-5]\d", eta)):
        eta = None
    return {"intent": intent, "eta": eta}
