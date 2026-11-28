"""Medoro AI service: speech to text (Faster-Whisper), text to speech (Piper) and intent classification with a local
model (Ollama), behind one authenticated HTTP API for the Medoro app.

Runs on a persistent Linux host (not on Vercel). Listens on 127.0.0.1 only; Nginx terminates HTTPS in front of it.
Nothing is stored: uploaded audio is decoded from memory/temp files that are deleted at once, and no request body is
logged. There is no paid or remote AI fallback of any kind.

Environment:
  MEDORO_AI_TOKEN         shared bearer token (24+ characters), the same as AI_HR_SERVICE_TOKEN in the app
  WHISPER_MODEL           default "small"           WHISPER_COMPUTE  default "int8"
  WHISPER_THREADS         default 2                 WHISPER_LANGUAGE default "" (auto) or "hi" / "en"
  PIPER_VOICE             path to the .onnx voice (default /opt/medoro-ai/voices/hi_IN-priyamvada-medium.onnx)
  OLLAMA_URL              default http://127.0.0.1:11434
  OLLAMA_MODEL            default "medoro-hr"
"""
from __future__ import annotations

import asyncio
import base64
import hmac
import io
import json
import os
import re
import resource
import tempfile
import time
import wave
from typing import Any

import httpx
from fastapi import Depends, FastAPI, File, Header, HTTPException, UploadFile
from pydantic import BaseModel, Field

VERSION = "1.0.0"
TOKEN = os.environ.get("MEDORO_AI_TOKEN", "")
WHISPER_MODEL = os.environ.get("WHISPER_MODEL", "small")
WHISPER_COMPUTE = os.environ.get("WHISPER_COMPUTE", "int8")
WHISPER_THREADS = int(os.environ.get("WHISPER_THREADS", "2"))
WHISPER_LANGUAGE = os.environ.get("WHISPER_LANGUAGE", "") or None
PIPER_VOICE = os.environ.get("PIPER_VOICE", "/opt/medoro-ai/voices/hi_IN-priyamvada-medium.onnx")
OLLAMA_URL = os.environ.get("OLLAMA_URL", "http://127.0.0.1:11434").rstrip("/")
OLLAMA_MODEL = os.environ.get("OLLAMA_MODEL", "medoro-hr")
MAX_AUDIO = 3_000_000
# A Hinglish prompt nudges Whisper towards romanised Hinglish instead of translating into English.
STT_PROMPT = "Haan ji, main traffic mein hoon, gyarah baje tak pahunch jaunga. Aaj leave chahiye. Checkout bhool gaya."

app = FastAPI(title="Medoro AI service", version=VERSION, docs_url=None, redoc_url=None, openapi_url=None)

# One request at a time per engine on an 8 GB host: queued requests wait instead of exhausting memory.
_stt_lock = asyncio.Semaphore(1)
_tts_lock = asyncio.Semaphore(1)
_llm_lock = asyncio.Semaphore(1)
_whisper: Any = None
_piper: Any = None


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


def piper():
    global _piper
    if _piper is None:
        from piper import PiperVoice

        _piper = PiperVoice.load(PIPER_VOICE)
    return _piper


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
    rss = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024  # peak RSS, MB (Linux reports KB)
    return {"total_mb": round(info.get("MemTotal", 0), 1), "available_mb": round(info.get("MemAvailable", 0), 1), "process_rss_mb": round(rss, 1)}


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
    tts = {"ok": os.path.exists(PIPER_VOICE), "voice": os.path.basename(PIPER_VOICE)}
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


def speakable(text: str) -> str:
    """Times and short forms read naturally: 11:30 -> 11 30, HR -> H R, removes source tags in brackets."""
    t = re.sub(r"\((Source|स्रोत):[^)]*\)", "", text)
    t = re.sub(r"\b(\d{1,2}):(\d{2})\b", lambda m: m.group(1) if m.group(2) == "00" else f"{m.group(1)} {m.group(2)}", t)
    t = re.sub(r"\bHRMS\b", "H R M S", t)
    t = re.sub(r"\bHR\b", "H R", t)
    t = re.sub(r"\bAI\b", "A I", t)
    return re.sub(r"\s+", " ", t).strip()


@app.post("/tts", dependencies=[Depends(require_token)])
async def tts(body: TtsIn) -> dict[str, Any]:
    if not os.path.exists(PIPER_VOICE):
        raise HTTPException(503, "voice model not installed")
    t0 = time.perf_counter()
    async with _tts_lock:
        wav = await asyncio.to_thread(_synthesize, speakable(body.text))
    return {"audio_b64": base64.b64encode(wav).decode(), "mime": "audio/wav", "ms": int((time.perf_counter() - t0) * 1000)}


def _synthesize(text: str) -> bytes:
    voice = piper()
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        if hasattr(voice, "synthesize_wav"):  # piper-tts >= 1.3
            voice.synthesize_wav(text, w)
        else:  # older piper-tts
            voice.synthesize(text, w)
    return buf.getvalue()


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
