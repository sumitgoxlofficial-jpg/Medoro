"""API tests for the Medoro AI service. Models are replaced by fakes so these run anywhere in a second; the real models
are exercised by scripts/benchmark.py on the AI host (see docs/ai-hr-assistant/HANDOVER.md)."""
import asyncio
import base64
import io
import os
import threading
import time
import wave

import numpy as np

os.environ["MEDORO_AI_TOKEN"] = "t" * 32
os.environ["TTS_LEXICON_PATH"] = ""
os.environ["TTS_WARM"] = "0"

from fastapi.testclient import TestClient  # noqa: E402

import app.main as m  # noqa: E402

client = TestClient(m.app)
AUTH = {"authorization": "Bearer " + "t" * 32}


class FakeSegment:
    def __init__(self, text, nsp=0.1):
        self.text, self.no_speech_prob = text, nsp


class FakeInfo:
    language = "hi"


class FakeWhisper:
    def transcribe(self, path, **kw):
        assert os.path.exists(path)
        assert kw["vad_filter"] is True and kw["beam_size"] == 1
        return iter([FakeSegment(" haan traffic mein hoon"), FakeSegment(" 11 baje", 0.2), FakeSegment(" noise", 0.95)]), FakeInfo()


class FakeKokoro:
    """Stands in for Kokoro: a tone whose length follows the text, and a record of what it was asked to say."""
    name, loaded, load_ms, error = "kokoro", True, 1, None

    def __init__(self, delay=0.0):
        self.calls, self.delay, self.active, self.peak = [], delay, 0, 0
        self._l = threading.Lock()

    def voices(self):
        return ["hf_alpha", "hf_beta"]

    def load(self):
        pass

    def unload(self):
        self.loaded = False

    def synth(self, text, voice, speed, english):
        with self._l:
            self.active += 1
            self.peak = max(self.peak, self.active)
        try:
            time.sleep(self.delay)
            self.calls.append((text, voice, speed, english))
            n = int(24000 * min(2.0, 0.02 * len(text)))
            return (0.5 * np.sin(np.arange(n) / 8)).astype(np.float32)
        finally:
            with self._l:
                self.active -= 1


def use(monkeypatch, engine):
    monkeypatch.setattr(m.VOICE, "engine", engine)
    m._tts_cache.clear()
    return engine


def test_auth_required_everywhere():
    for method, path in [("get", "/health"), ("post", "/tts"), ("post", "/llm/classify")]:
        assert getattr(client, method)(path).status_code == 401
        assert getattr(client, method)(path, headers={"authorization": "Bearer wrong"}).status_code == 401
    assert client.post("/stt", files={"audio": ("a.webm", b"x" * 600)}).status_code == 401


def test_no_docs_exposed():
    assert client.get("/docs").status_code == 404
    assert client.get("/openapi.json").status_code == 404


def test_health_reports_engines_without_ollama(monkeypatch):
    r = client.get("/health", headers=AUTH)
    assert r.status_code == 200
    j = r.json()
    assert j["llm"]["ok"] is False and "Ollama" in j["llm"]["error"]
    assert j["memory"]["total_mb"] > 0
    assert j["cpu"]["count"] > 0


def test_stt_transcribes_and_drops_non_speech(monkeypatch):
    monkeypatch.setattr(m, "_whisper", FakeWhisper())
    r = client.post("/stt", headers=AUTH, files={"audio": ("turn.webm", b"\x1a\x45" * 400, "audio/webm")})
    assert r.status_code == 200
    assert r.json()["text"] == "haan traffic mein hoon 11 baje"
    assert r.json()["language"] == "hi"


def test_stt_limits(monkeypatch):
    monkeypatch.setattr(m, "_whisper", FakeWhisper())
    assert client.post("/stt", headers=AUTH, files={"audio": ("t.webm", b"x" * 100)}).json()["no_speech"] is True
    assert client.post("/stt", headers=AUTH, files={"audio": ("t.webm", b"x" * (m.MAX_AUDIO + 1))}).status_code == 413


def test_tts_contract_and_wav(monkeypatch):
    eng = use(monkeypatch, FakeKokoro())
    r = client.post("/tts", headers=AUTH, json={"text": "Namaste Rahul ji, aapka attendance record incomplete hai."})
    assert r.status_code == 200
    j = r.json()
    assert set(["audio_b64", "mime", "ms"]) <= set(j) and j["mime"] == "audio/wav" and isinstance(j["ms"], int)
    assert j["engine"] == "kokoro" and j["voice"] == "hf_alpha" and j["lang"] == "hinglish" and j["sample_rate"] == 24000
    with wave.open(io.BytesIO(base64.b64decode(j["audio_b64"]))) as w:
        assert w.getframerate() == 24000 and w.getnchannels() == 1 and w.getsampwidth() == 2 and w.getnframes() > 24000
    # Kokoro was given Devanagari only: Roman Hinglish is never read with English phonemes.
    said = " ".join(c[0] for c in eng.calls)
    assert said == "नमस्ते राहुल जी, आपका अटेंडेंस रिकॉर्ड इनकम्प्लीट है।"
    assert not any(ch.isascii() and ch.isalpha() for ch in said)


def test_tts_invalid_input(monkeypatch):
    use(monkeypatch, FakeKokoro())
    assert client.post("/tts", headers=AUTH, json={"text": ""}).status_code == 422
    assert client.post("/tts", headers=AUTH, json={"text": "x" * 1201}).status_code == 422
    assert client.post("/tts", headers=AUTH, json={"text": " ... "}).status_code == 422
    assert client.post("/tts", headers=AUTH, json={"text": "ok", "speed": 3}).status_code == 422
    assert client.post("/tts", headers=AUTH, json={"text": "ok", "lang": "fr"}).status_code == 422
    assert client.post("/tts", headers=AUTH, json={}).status_code == 422
    assert client.post("/tts", headers=AUTH, content=b"not json").status_code == 422


def test_tts_optional_voice_and_speed(monkeypatch):
    eng = use(monkeypatch, FakeKokoro())
    j = client.post("/tts", headers=AUTH, json={"text": "धन्यवाद", "voice": "hf_beta", "speed": 1.1}).json()
    assert j["voice"] == "hf_beta" and eng.calls[-1][1:3] == ("hf_beta", 1.1)
    j = client.post("/tts", headers=AUTH, json={"text": "धन्यवाद जी", "voice": "af_unknown"}).json()
    assert j["voice"] == "hf_alpha"  # unknown voices fall back to the default, never an error


def test_tts_english_and_long_text(monkeypatch):
    eng = use(monkeypatch, FakeKokoro())
    j = client.post("/tts", headers=AUTH, json={"text": "Your check-in hasn't been recorded yet today. Are you on your way to the office?"}).json()
    assert j["lang"] == "en" and eng.calls[-1][3] is True and j["chunks"] == 2
    long = "Aapki shift das baje start hoti hai, aur aapka check-in abhi tak record nahi hua hai. " * 8
    j = client.post("/tts", headers=AUTH, json={"text": long[:1200]}).json()
    assert j["chunks"] >= 8 and all(len(c[0]) <= 220 for c in eng.calls)


def test_tts_repeats_come_from_the_cache(monkeypatch):
    eng = use(monkeypatch, FakeKokoro())
    line = "Bataiye, main aapki kis tarah madad kar sakti hoon?"
    a = client.post("/tts", headers=AUTH, json={"text": line}).json()
    b = client.post("/tts", headers=AUTH, json={"text": line}).json()
    assert a["cached"] is False and b["cached"] is True and a["audio_b64"] == b["audio_b64"]
    assert len(eng.calls) == 1
    c = client.post("/tts", headers=AUTH, json={"text": line, "voice": "hf_beta"}).json()
    assert c["cached"] is False  # another voice is another recording
    monkeypatch.setattr(m, "TTS_CACHE_SIZE", 2)
    for t in ("ek", "do", "teen"):
        client.post("/tts", headers=AUTH, json={"text": t})
    assert len(m._tts_cache) == 2 and all(k[-1] != line for k in m._tts_cache)  # oldest lines make room
    monkeypatch.setattr(m, "TTS_CACHE_MB", 0.000001)
    client.post("/tts", headers=AUTH, json={"text": "chaar"})
    assert len(m._tts_cache) == 1  # the megabyte bound keeps only the newest


def test_tts_engine_down_is_503_not_a_crash(monkeypatch):
    from app.tts import OffEngine
    use(monkeypatch, OffEngine())
    assert client.post("/tts", headers=AUTH, json={"text": "नमस्ते"}).status_code == 503
    h = client.get("/health", headers=AUTH).json()
    assert h["tts"]["ok"] is False and h["tts"]["engine"] == "off"


def test_tts_one_synthesis_at_a_time_and_queue_limit(monkeypatch):
    eng = use(monkeypatch, FakeKokoro(delay=0.05))

    async def burst(n):
        import httpx
        m._tts_lock = asyncio.Semaphore(1)  # a fresh lock on this test's own event loop
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=m.app), base_url="http://t") as c:
            return await asyncio.gather(*[c.post("/tts", headers=AUTH, json={"text": f"line {i} hai"}) for i in range(n)])
    rs = asyncio.run(burst(6))
    assert all(r.status_code == 200 for r in rs) and eng.peak == 1
    monkeypatch.setattr(m, "TTS_QUEUE_MAX", 2)
    m._tts_cache.clear()
    rs = asyncio.run(burst(8))
    codes = sorted(r.status_code for r in rs)
    assert codes.count(503) >= 1 and codes.count(200) >= 2 and eng.peak == 1


def test_tts_health_reports_voice(monkeypatch):
    use(monkeypatch, FakeKokoro())
    client.post("/tts", headers=AUTH, json={"text": "नमस्ते जी"})
    t = client.get("/health", headers=AUTH).json()["tts"]
    assert t["ok"] is True and t["engine"] == "kokoro" and t["voice"] == "hf_alpha" and t["voices"] == ["hf_alpha", "hf_beta"]
    assert t["lexicon"]["terms"] >= 500 and t["requests"] >= 1 and t["avg_ms"] is not None and t["last_ok_at"]
    assert "नमस्ते" not in str(t)  # health never echoes what was said


def test_speakable():
    assert m.speakable("HR ko 11:30 aur 10:00 baje. (Source: Leave)") == "H R ko 11 30 aur 10 baje."


def test_classification_is_validated():
    allowed = {"coming", "absent", "unknown"}
    assert m.validate_classification('{"intent":"coming","eta":"11:30"}', allowed) == {"intent": "coming", "eta": "11:30"}
    assert m.validate_classification('{"intent":"approve_leave"}', allowed)["intent"] == "unknown"
    assert m.validate_classification('{"intent":"coming","eta":"11 baje"}', allowed)["eta"] is None
    assert m.validate_classification("not json", allowed)["intent"] == "unknown"


def test_classify_reports_missing_model():
    r = client.post("/llm/classify", headers=AUTH, json={"utterance": "hmm", "call_reason": "late", "intents": ["coming", "unknown"]})
    assert r.status_code == 503
