"""API tests for the Medoro AI service. Models are replaced by fakes so these run anywhere in a second; the real models
are exercised by scripts/benchmark.py on the AI host (see docs/ai-hr-assistant/HANDOVER.md)."""
import base64
import io
import os
import wave

os.environ["MEDORO_AI_TOKEN"] = "t" * 32
os.environ["PIPER_VOICE"] = __file__  # any existing path: the voice itself is faked below

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


class FakeVoice:
    def synthesize_wav(self, text, w):
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(22050)
        w.writeframes(b"\x00\x00" * 2205)


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


def test_tts_returns_wav(monkeypatch):
    monkeypatch.setattr(m, "_piper", FakeVoice())
    r = client.post("/tts", headers=AUTH, json={"text": "Theek hai, 11:30 baje note kar rahi hoon. (Source: Leave)"})
    assert r.status_code == 200
    wav = base64.b64decode(r.json()["audio_b64"])
    with wave.open(io.BytesIO(wav)) as w:
        assert w.getframerate() == 22050 and w.getnframes() == 2205
    assert client.post("/tts", headers=AUTH, json={"text": ""}).status_code == 422
    assert client.post("/tts", headers=AUTH, json={"text": "x" * 1201}).status_code == 422


def test_tts_repeats_come_from_the_cache(monkeypatch):
    calls = []

    class CountingVoice(FakeVoice):
        def synthesize_wav(self, text, w):
            calls.append(text)
            super().synthesize_wav(text, w)

    monkeypatch.setattr(m, "_piper", CountingVoice())
    m._tts_cache.clear()
    line = "Bataiye, main aapki kis tarah madad kar sakti hoon?"
    a = client.post("/tts", headers=AUTH, json={"text": line}).json()
    b = client.post("/tts", headers=AUTH, json={"text": line}).json()
    assert a["cached"] is False and b["cached"] is True and a["audio_b64"] == b["audio_b64"]
    assert len(calls) == 1
    monkeypatch.setattr(m, "TTS_CACHE_SIZE", 2)
    for t in ("one", "two", "three"):
        client.post("/tts", headers=AUTH, json={"text": t})
    assert len(m._tts_cache) == 2 and line not in m._tts_cache  # oldest lines make room


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
