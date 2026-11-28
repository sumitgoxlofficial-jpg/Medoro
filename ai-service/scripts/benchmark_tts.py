#!/usr/bin/env python3
"""Benchmarks Naina's Kokoro voice through the real HTTP API, on the machine it runs on.

    # on the AI host, from /opt/medoro-ai/service (or ai-service/ in a checkout), with the venv's python:
    python scripts/benchmark_tts.py --spawn --out /tmp/medoro-tts-bench          # starts its own server on :8099
    python scripts/benchmark_tts.py --url http://127.0.0.1:8090 --token "$TOKEN"  # against the running service

Measures: cold start (spawn -> voice loaded), warm latency for hf_alpha and hf_beta on real Naina lines
(tests/data/naina_lines.json, exported from the app's engine over the 1,000-scenario library), real-time factor, cache
hits, a concurrent burst, recovery after bad requests, resident memory and CPU of the service process.
Writes results.json, one WAV per line and voice, and listening-sheet.csv for a person to rate (1-5) how natural each
line sounds. Nothing here decides the production voice: a person listens and picks.
"""
from __future__ import annotations

import argparse
import asyncio
import base64
import csv
import json
import os
import statistics
import subprocess
import sys
import time
from pathlib import Path

import httpx

HERE = Path(__file__).resolve().parent.parent


def pct(xs: list[float], p: float) -> float:
    xs = sorted(xs)
    return round(xs[min(len(xs) - 1, int(round(p / 100 * (len(xs) - 1))))], 1) if xs else 0.0


def proc_stats(pid: int) -> dict[str, float]:
    """RSS (MB) and CPU seconds of a process, from /proc (Linux)."""
    out = {"rss_mb": 0.0, "cpu_s": 0.0}
    try:
        with open(f"/proc/{pid}/status") as f:
            for line in f:
                if line.startswith("VmRSS:"):
                    out["rss_mb"] = int(line.split()[1]) / 1024
                if line.startswith("VmHWM:"):
                    out["peak_rss_mb"] = int(line.split()[1]) / 1024
        with open(f"/proc/{pid}/stat") as f:
            parts = f.read().rsplit(")", 1)[1].split()
            out["cpu_s"] = (int(parts[11]) + int(parts[12])) / os.sysconf("SC_CLK_TCK")
    except OSError:
        pass
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default="")
    ap.add_argument("--token", default=os.environ.get("MEDORO_AI_TOKEN", ""))
    ap.add_argument("--spawn", action="store_true", help="start a server on 127.0.0.1:8099 and measure cold start")
    ap.add_argument("--lines", default=str(HERE / "tests" / "data" / "naina_lines.json"))
    ap.add_argument("--count", type=int, default=24, help="real lines per voice (spread over the library)")
    ap.add_argument("--voices", default="hf_alpha,hf_beta")
    ap.add_argument("--concurrency", type=int, default=4)
    ap.add_argument("--out", default="/tmp/medoro-tts-bench")
    a = ap.parse_args()
    out = Path(a.out)
    (out / "wav").mkdir(parents=True, exist_ok=True)
    data = json.loads(Path(a.lines).read_text(encoding="utf-8"))
    pairs = [p for p in data["pairs"] if any("ऀ" <= ch <= "ॿ" for ch in p["speech"])]
    step = max(1, len(pairs) // a.count)
    lines = [pairs[i] for i in range(0, len(pairs), step)][: a.count]
    long_line = " ".join(p["speech"] for p in pairs[:6])[:1150]

    proc = None
    res: dict = {"host": {"cpus": os.cpu_count(), "python": sys.version.split()[0]}, "lines": len(lines)}
    try:
        with open("/proc/meminfo") as f:
            res["host"]["mem_total_mb"] = round(int(f.readline().split()[1]) / 1024)
    except OSError:
        pass
    token = a.token
    url = a.url
    if a.spawn:
        token = token or "b" * 32
        url = "http://127.0.0.1:8099"
        env = {**os.environ, "MEDORO_AI_TOKEN": token, "TTS_WARM": "0"}
        t0 = time.perf_counter()
        proc = subprocess.Popen([sys.executable, "-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", "8099", "--workers", "1", "--no-access-log"],
                                cwd=HERE, env=env, stdout=subprocess.DEVNULL, stderr=open(out / "server.log", "w"))
    H = {"authorization": f"Bearer {token}"}
    c = httpx.Client(base_url=url, headers=H, timeout=120)
    try:
        if proc:
            while True:  # cold start: process start -> HTTP up -> model loaded
                try:
                    h = c.get("/health").json()
                    if h["tts"]["loaded"] or h["tts"].get("error"):
                        break
                except (httpx.HTTPError, KeyError, ValueError):
                    pass
                if proc.poll() is not None:
                    print("server exited; see", out / "server.log")
                    return 1
                time.sleep(0.25)
            res["cold_start_s"] = round(time.perf_counter() - t0, 2)
            res["model_load_ms"] = h["tts"].get("load_ms")
            res["rss_after_load_mb"] = round(proc_stats(proc.pid)["rss_mb"], 1)
            # First synthesis after load (graph warm-up) is reported separately from the warm numbers.
            t = time.perf_counter()
            c.post("/tts", json={"text": "नमस्ते, मैं नैना हूँ।"})
            res["first_request_ms"] = int((time.perf_counter() - t) * 1000)
        pid = proc.pid if proc else None
        cpu0, wall0 = (proc_stats(pid)["cpu_s"] if pid else 0.0), time.perf_counter()
        sheet = []
        res["voices"] = {}
        for voice in a.voices.split(","):
            lat, rtf, audio_ms = [], [], []
            for i, p in enumerate(lines):
                t = time.perf_counter()
                r = c.post("/tts", json={"text": p["speech"], "voice": voice})
                ms = (time.perf_counter() - t) * 1000
                if r.status_code != 200:  # recorded, never hidden
                    res.setdefault("failures", []).append({"voice": voice, "line": i, "status": r.status_code, "ms": round(ms)})
                    continue
                j = r.json()
                lat.append(ms)
                audio_ms.append(j.get("duration_ms") or 0)
                rtf.append(ms / max(1, j.get("duration_ms") or 1))
                name = f"{voice}_{i:02d}.wav"
                (out / "wav" / name).write_bytes(base64.b64decode(j["audio_b64"]))
                sheet.append({"file": f"wav/{name}", "voice": voice, "display": p["display"], "speech": p["speech"], "natural_1to5": "", "pronunciation_1to5": "", "notes": ""})
            res["voices"][voice] = {"n": len(lat), "avg_ms": round(statistics.mean(lat)), "p50_ms": pct(lat, 50), "p95_ms": pct(lat, 95), "max_ms": round(max(lat)),
                                    "avg_audio_ms": round(statistics.mean(audio_ms)), "rtf_avg": round(statistics.mean(rtf), 2)}
        if pid:
            cpu1, wall1 = proc_stats(pid)["cpu_s"], time.perf_counter()
            res["cpu_during_sequential_pct"] = round(100 * (cpu1 - cpu0) / (wall1 - wall0), 1)
        # Long reply (chunked)
        t = time.perf_counter()
        r = c.post("/tts", json={"text": long_line})
        j = r.json() if r.status_code == 200 else {}
        res["long_reply"] = {"chars": len(long_line), "status": r.status_code, "chunks": j.get("chunks"), "ms": int((time.perf_counter() - t) * 1000), "audio_ms": j.get("duration_ms")}
        # The app's way: one sentence at a time; the time to the first sound is what the employee waits for.
        first = long_line.split("।")[0] + "।"
        t = time.perf_counter()
        c.post("/tts", json={"text": first, "voice": "hf_beta"})
        res["long_reply"]["first_sentence_ms"] = int((time.perf_counter() - t) * 1000)
        # Cache hit
        t = time.perf_counter()
        j = c.post("/tts", json={"text": lines[0]["speech"], "voice": "hf_alpha"}).json()
        res["cache_hit"] = {"cached": j.get("cached"), "ms": int((time.perf_counter() - t) * 1000)}

        # Concurrent burst: distinct texts so nothing comes from the cache
        async def burst() -> list:
            async with httpx.AsyncClient(base_url=url, headers=H, timeout=180) as ac:
                async def one(i: int):
                    t = time.perf_counter()
                    r = await ac.post("/tts", json={"text": f"{lines[i % len(lines)]['speech']} ({i})", "voice": "hf_beta"})
                    return r.status_code, (time.perf_counter() - t) * 1000
                return await asyncio.gather(*[one(i) for i in range(a.concurrency)])
        t = time.perf_counter()
        rs = asyncio.run(burst())
        res["concurrent"] = {"requests": a.concurrency, "ok": sum(1 for s, _ in rs if s == 200), "busy_503": sum(1 for s, _ in rs if s == 503),
                             "wall_ms": int((time.perf_counter() - t) * 1000), "max_ms": round(max(ms for _, ms in rs))}
        # Recovery: bad inputs must not break the voice
        bad = [c.post("/tts", json={"text": ""}).status_code, c.post("/tts", json={"text": " ... "}).status_code, c.post("/tts", content=b"{").status_code]
        ok = c.post("/tts", json={"text": "ठीक है, धन्यवाद।"}).status_code
        res["recovery"] = {"bad_request_codes": bad, "next_request": ok}
        h = c.get("/health").json()
        res["health"] = {"tts": {k: h["tts"].get(k) for k in ("engine", "voice", "voices", "load_ms", "avg_ms", "errors", "recoveries")}, "memory": h.get("memory")}
        if pid:
            ps = proc_stats(pid)
            res["service_rss_now_mb"], res["service_peak_rss_mb"] = round(ps["rss_mb"], 1), round(ps.get("peak_rss_mb", 0), 1)
    finally:
        c.close()
        if proc:
            proc.terminate()
            try:
                proc.wait(15)
            except subprocess.TimeoutExpired:
                proc.kill()
    (out / "results.json").write_text(json.dumps(res, ensure_ascii=False, indent=1), encoding="utf-8")
    with open(out / "listening-sheet.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=list(sheet[0].keys()))
        w.writeheader()
        w.writerows(sheet)
    print(json.dumps(res, ensure_ascii=False, indent=1))
    print(f"\nWAVs and listening-sheet.csv in {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
