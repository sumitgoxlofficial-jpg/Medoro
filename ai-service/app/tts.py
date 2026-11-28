"""Text to speech engines for Naina's voice.

  kokoro  (default) Kokoro-82M, Apache-2.0, self-hosted on CPU. Hindi pipeline (lang "h") with the female voices
          hf_alpha (default) and hf_beta. The model is loaded once and shared by every request.
  piper   the previous Piper engine, kept only for rollback. It needs PIPER_VOICE set explicitly; the installer no
          longer downloads the hi_IN-priyamvada voice (its licence is non-commercial; see docs/ai-hr-assistant/SECURITY.md).
  off     no server voice: /tts answers 503 and the app falls back to text or the device's own voice.

Synthesis: display text -> speech text (app/speech) -> sentence chunks -> Kokoro -> trimmed audio joined with
punctuation-aware pauses -> peak-limited 16-bit mono WAV at 24 kHz. Nothing here logs or stores the text.
"""
from __future__ import annotations

import ctypes
import io
import logging
import os
import threading
import time
import wave
from dataclasses import dataclass, field
from typing import Any

import numpy as np

from .speech import Normalizer, split_chunks

log = logging.getLogger("medoro.tts")

KOKORO_VOICES_HI = ("hf_alpha", "hf_beta")
KOKORO_VOICES_EN = ("bf_emma", "bf_isabella", "af_heart", "af_bella")
SAMPLE_RATE = 24_000


def env_float(name: str, default: float) -> float:
    try:
        return float(os.environ.get(name, default))
    except ValueError:
        return default


@dataclass
class Settings:
    engine: str = field(default_factory=lambda: os.environ.get("TTS_ENGINE", "kokoro").strip().lower() or "kokoro")
    repo: str = field(default_factory=lambda: os.environ.get("KOKORO_MODEL", "hexgrad/Kokoro-82M"))
    lang: str = field(default_factory=lambda: os.environ.get("KOKORO_LANG", "h"))
    voice: str = field(default_factory=lambda: os.environ.get("KOKORO_VOICE", "hf_alpha"))
    # English replies: "same_voice" keeps Naina's Hindi voice (Kokoro's Hindi pipeline reads Latin text with English
    # phonemes); "english_voice" uses Kokoro's English pipeline and KOKORO_EN_VOICE (needs spaCy en_core_web_sm).
    en_mode: str = field(default_factory=lambda: os.environ.get("KOKORO_EN_MODE", "same_voice"))
    en_voice: str = field(default_factory=lambda: os.environ.get("KOKORO_EN_VOICE", "bf_emma"))
    speed: float = field(default_factory=lambda: env_float("TTS_SPEED", 0.95))
    pause_ms: int = field(default_factory=lambda: int(env_float("TTS_PAUSE_MS", 260)))
    chunk_chars: int = field(default_factory=lambda: int(env_float("TTS_CHUNK_CHARS", 220)))
    threads: int = field(default_factory=lambda: int(env_float("TTS_THREADS", env_float("OMP_NUM_THREADS", 2))))
    piper_voice: str = field(default_factory=lambda: os.environ.get("PIPER_VOICE", ""))


class EngineUnavailable(RuntimeError):
    pass


try:  # glibc only (Ubuntu): hands freed memory back to the system after each reply
    _libc = ctypes.CDLL("libc.so.6")
    _trim = _libc.malloc_trim
except (OSError, AttributeError):  # pragma: no cover - other platforms
    _trim = None


def release_memory() -> None:
    """Measured on Kokoro (TEST-REPORT.md): without this, resident memory climbs from ~1.0 GB to ~2.4 GB over ten
    replies (allocator fragmentation from tensors of varying length); with it, it stays at ~1.3 GB, at no speed cost."""
    if _trim is not None:
        _trim(0)


def to_wav(samples: np.ndarray, rate: int = SAMPLE_RATE) -> bytes:
    pcm = (np.clip(samples, -1.0, 1.0) * 32767).astype("<i2")
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(pcm.tobytes())
    return buf.getvalue()


def trim(a: np.ndarray, rate: int = SAMPLE_RATE, threshold: float = 0.004, keep_ms: int = 30) -> np.ndarray:
    """Cuts leading/trailing near-silence (keeping a few ms so consonants aren't clipped)."""
    if a.size == 0:
        return a
    loud = np.flatnonzero(np.abs(a) > threshold)
    if loud.size == 0:
        return a[:0]
    keep = int(rate * keep_ms / 1000)
    return a[max(0, loud[0] - keep): min(a.size, loud[-1] + keep)]


def assemble(chunks: list[tuple[np.ndarray, str]], pause_ms: int, rate: int = SAMPLE_RATE) -> np.ndarray:
    """Joins chunk audio with pauses: sentence (pause_ms), question (+20%), comma split (40%). Peak-limited to 0.95."""
    gaps = {"s": pause_ms, "q": int(pause_ms * 1.2), "c": int(pause_ms * 0.4)}
    parts: list[np.ndarray] = []
    for i, (a, kind) in enumerate(chunks):
        a = trim(a.astype(np.float32), rate)
        if a.size == 0:
            continue
        parts.append(a)
        if i < len(chunks) - 1:
            parts.append(np.zeros(int(rate * gaps.get(kind, pause_ms) / 1000), dtype=np.float32))
    if not parts:
        return np.zeros(0, dtype=np.float32)
    out = np.concatenate(parts)
    peak = float(np.max(np.abs(out))) if out.size else 0.0
    if peak > 0.95:
        out = out * (0.95 / peak)
    lead = np.zeros(int(rate * 0.05), dtype=np.float32)  # 50 ms so the first syllable isn't lost by audio players
    return np.concatenate([lead, out, lead])


class KokoroEngine:
    name = "kokoro"

    def __init__(self, s: Settings):
        self.s = s
        self._model: Any = None
        self._pipelines: dict[str, Any] = {}
        self._lock = threading.Lock()
        self.load_ms: int | None = None
        self.error: str | None = None

    @property
    def loaded(self) -> bool:
        return self._model is not None

    def voices(self) -> list[str]:
        return list(KOKORO_VOICES_HI) + (list(KOKORO_VOICES_EN) if self.s.en_mode == "english_voice" else [])

    def load(self) -> None:
        """Loads the model and the Hindi voices once (downloaded once into HF_HOME, then read from disk)."""
        with self._lock:
            if self._model is not None:
                return
            t0 = time.perf_counter()
            try:
                import torch
                from kokoro import KModel

                from kokoro import KPipeline

                torch.set_num_threads(max(1, self.s.threads))
                model = KModel(repo_id=self.s.repo).eval()
                pipe = KPipeline(lang_code=self.s.lang, repo_id=self.s.repo, model=model)
                for v in KOKORO_VOICES_HI:
                    pipe.load_voice(v)
            except Exception as e:  # noqa: BLE001 - reported in /health, never crashes the service
                self._model, self._pipelines = None, {}
                self.error = f"{type(e).__name__}: {str(e)[:160]}"
                raise EngineUnavailable(self.error) from e
            # Published only when everything is ready, so /health never shows "loaded" half-way.
            self.load_ms = int((time.perf_counter() - t0) * 1000)
            self._pipelines, self.error, self._model = {self.s.lang: pipe}, None, model
            log.info("kokoro loaded in %d ms", self.load_ms)

    def unload(self) -> None:
        with self._lock:
            self._model, self._pipelines = None, {}

    def _pipeline(self, code: str) -> Any:
        if code not in self._pipelines:
            from kokoro import KPipeline

            self._pipelines[code] = KPipeline(lang_code=code, repo_id=self.s.repo, model=self._model)
        return self._pipelines[code]

    def synth(self, text: str, voice: str, speed: float, english: bool) -> np.ndarray:
        if self._model is None:
            self.load()
        code, v = self.s.lang, voice
        if english and self.s.en_mode == "english_voice":
            code, v = ("b" if self.s.en_voice.startswith("b") else "a"), self.s.en_voice
        pipe = self._pipeline(code)
        import torch

        with torch.inference_mode():  # no autograd bookkeeping: less memory, same audio
            audio = [r.audio.detach().cpu().numpy() if hasattr(r.audio, "detach") else np.asarray(r.audio) for r in pipe(text, voice=v, speed=speed, split_pattern=None) if r.audio is not None]
        return np.concatenate(audio) if audio else np.zeros(0, dtype=np.float32)


class PiperEngine:
    """Rollback only. Never selected unless TTS_ENGINE=piper and PIPER_VOICE points at an installed voice."""
    name = "piper"

    def __init__(self, s: Settings):
        self.s = s
        self._voice: Any = None
        self.load_ms: int | None = None
        self.error: str | None = None if s.piper_voice and os.path.exists(s.piper_voice) else "PIPER_VOICE not installed"

    @property
    def loaded(self) -> bool:
        return self._voice is not None

    def voices(self) -> list[str]:
        return [os.path.basename(self.s.piper_voice)] if self.s.piper_voice else []

    def load(self) -> None:
        if self.error:
            raise EngineUnavailable(self.error)
        if self._voice is None:
            from piper import PiperVoice

            t0 = time.perf_counter()
            self._voice = PiperVoice.load(self.s.piper_voice)
            self.load_ms = int((time.perf_counter() - t0) * 1000)

    def unload(self) -> None:
        self._voice = None

    def synth(self, text: str, voice: str, speed: float, english: bool) -> np.ndarray:
        self.load()
        buf = io.BytesIO()
        with wave.open(buf, "wb") as w:
            (self._voice.synthesize_wav if hasattr(self._voice, "synthesize_wav") else self._voice.synthesize)(text, w)
        buf.seek(0)
        with wave.open(buf) as r:
            self.rate = r.getframerate()
            return np.frombuffer(r.readframes(r.getnframes()), dtype="<i2").astype(np.float32) / 32768


class OffEngine:
    name = "off"
    loaded = False
    load_ms = None
    error = "TTS_ENGINE=off"

    def voices(self) -> list[str]:
        return []

    def load(self) -> None:
        raise EngineUnavailable(self.error)

    def unload(self) -> None:
        pass

    def synth(self, *a: Any, **k: Any) -> np.ndarray:
        raise EngineUnavailable(self.error)


@dataclass
class Stats:
    requests: int = 0
    cache_hits: int = 0
    errors: int = 0
    consecutive_errors: int = 0
    total_ms: int = 0
    synthesized: int = 0
    last_ms: int | None = None
    last_ok_at: float | None = None
    last_error: str | None = None
    recoveries: int = 0

    def as_dict(self) -> dict[str, Any]:
        return {
            "requests": self.requests, "cache_hits": self.cache_hits, "errors": self.errors, "recoveries": self.recoveries,
            "avg_ms": round(self.total_ms / self.synthesized) if self.synthesized else None, "last_ms": self.last_ms,
            "last_ok_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(self.last_ok_at)) if self.last_ok_at else None,
            "last_error": self.last_error,
        }


class Voice:
    """Engine + normaliser + chunking. Thread-safe for one synthesis at a time (the caller limits concurrency)."""

    def __init__(self, settings: Settings | None = None, engine: Any = None, normalizer: Normalizer | None = None):
        self.s = settings or Settings()
        self.engine = engine or {"kokoro": KokoroEngine, "piper": PiperEngine}.get(self.s.engine, OffEngine)(self.s)
        self.norm = normalizer or Normalizer()
        self.stats = Stats()

    @property
    def rate(self) -> int:
        return getattr(self.engine, "rate", SAMPLE_RATE)

    def render(self, text: str, voice: str | None = None, speed: float | None = None, lang: str = "auto") -> dict[str, Any]:
        """Returns {"wav", "speech_chars", "chunks", "lang", "voice", "duration_ms"}; raises EngineUnavailable."""
        v = voice if voice in self.engine.voices() else self.s.voice
        sp = min(1.3, max(0.7, speed if speed else self.s.speed))
        speech, detected = self.norm.to_speech(text, lang)
        if not speech.strip(" ,।.?!"):
            raise ValueError("nothing to say")
        english = detected == "en"
        chunks = split_chunks(speech, self.s.chunk_chars)
        t0 = time.perf_counter()
        try:
            pieces = [(self.engine.synth(c, v, sp, english), kind) for c, kind in chunks]
        except EngineUnavailable:
            raise
        except Exception as e:  # noqa: BLE001 - one bad request must not take the voice down
            self._failed(e)
            raise EngineUnavailable(f"synthesis failed: {type(e).__name__}") from e
        finally:
            release_memory()
        audio = assemble(pieces, self.s.pause_ms, self.rate)
        if audio.size < self.rate * 0.12:
            self._failed(RuntimeError("empty audio"))
            raise EngineUnavailable("synthesis produced no audio")
        ms = int((time.perf_counter() - t0) * 1000)
        st = self.stats
        st.consecutive_errors, st.synthesized, st.total_ms, st.last_ms, st.last_ok_at = 0, st.synthesized + 1, st.total_ms + ms, ms, time.time()
        return {"wav": to_wav(audio, self.rate), "speech_chars": len(speech), "chunks": len(chunks), "lang": detected, "voice": v,
                "duration_ms": int(audio.size * 1000 / self.rate), "synth_ms": ms}

    def _failed(self, e: Exception) -> None:
        st = self.stats
        st.errors += 1
        st.consecutive_errors += 1
        st.last_error = type(e).__name__
        log.warning("tts synthesis failed: %s", type(e).__name__)
        if st.consecutive_errors >= 3:  # automatic recovery: drop the model; the next request loads it afresh
            log.warning("tts: 3 failures in a row, reloading the engine")
            self.engine.unload()
            st.consecutive_errors = 0
            st.recoveries += 1
