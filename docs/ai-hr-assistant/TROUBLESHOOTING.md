# AI HR Assistant: troubleshooting

Start with **HRMS → AI HR Assistant → Model status** and, on the AI host:

```bash
TOKEN=$(sudo grep ^MEDORO_AI_TOKEN= /etc/medoro-ai.env | cut -d= -f2)
```

```bash
curl -s -H "Authorization: Bearer $TOKEN" http://127.0.0.1:8090/health | python3 -m json.tool
```

```bash
journalctl -u medoro-ai -n 200 --no-pager
```

## Voice (Kokoro)

| Symptom | Cause / check | Fix |
|---|---|---|
| `/health` → `tts.loaded: false` for more than a minute after a restart | model still loading, or `tts.error` set | read `tts.error`; `journalctl -u medoro-ai` |
| `tts.error` mentions `LocalEntryNotFoundError` / `offline` | model files missing from the cache while `HF_HUB_OFFLINE=1` | run `scripts/fetch_kokoro.py` (KOKORO-TTS-SETUP.md §3) |
| `CustomAlbert requires PyTorch >= 2.6` | unpinned `transformers 5.x` installed | `pip install -r requirements.txt` (pins transformers 4.51.3 + torch 2.6.0+cpu) |
| `Requires-Python <3.13` when installing kokoro | Python 3.13 | use Python 3.10–3.12 (`python3.12 -m venv`) |
| Download fails behind a firewall / proxy | Hugging Face uses several CDN hosts | allow the hosts in KOKORO-TTS-SETUP.md §1, or copy `/opt/medoro-ai/cache/huggingface` from another machine |
| `/tts` answers **503 voice busy** | more than `TTS_QUEUE_MAX` requests waiting | normal under bursts (the app falls back to the device voice); raise `TTS_QUEUE_MAX` only if RAM allows |
| `/tts` answers **504** | one request took longer than `TTS_TIMEOUT_S` (a very long text on 2 cores) | the app sends one sentence at a time; for direct callers split the text, or raise `TTS_TIMEOUT_S` |
| Replies sound slow to start | first sentence must be made before she speaks (measured ~0.8 s on 2 cores) | keep `TTS_WARM=1`; give the service 4 threads if the host has spare cores (`TTS_THREADS=4`, `CPUQuota=400%`) |
| Service restarts under load, `journalctl` shows `oom` / `MemoryMax` | transient peaks ~2–2.7 GB (TEST-REPORT.md) plus Whisper | keep recognition in the browser; `WHISPER_MODEL=base` or `tiny`; keep `TTS_CONCURRENCY=1`; don't send very long texts |
| A word or name is mispronounced | not in the dictionaries, so the rule-based fallback guessed | add it to `/etc/medoro-ai/lexicon.json` (HINGLISH-PRONUNCIATION.md); `/health` → `tts.lexicon.overrides` counts accepted entries |
| Log says `lexicon override: skipped an entry` | a value wasn't Devanagari | write the value in Devanagari (`"tally": "टैली"`) |
| Log says `lexicon override unreadable` | invalid JSON | `python3 -m json.tool /etc/medoro-ai/lexicon.json` |
| Roman Hinglish read with English sounds | text reached the AI host as `lang:"en"` or as an English sentence | the app sends Devanagari speech text for Hindi/Hinglish conversations; for direct calls pass `"lang":"hinglish"` |
| `tts.recoveries` increasing | three failures in a row made the engine reload | look for the error type in the log; persistent → reinstall dependencies |
| English replies sound like the Hindi voice reading English | `KOKORO_EN_MODE=same_voice` (default, one persona) | `KOKORO_EN_MODE=english_voice` + `KOKORO_EN_VOICE=bf_emma` (a different, British-English voice) |

## App side

| Symptom | Check |
|---|---|
| Employees hear the phone's own voice, not Kokoro | Settings: Naina's voice = "Medoro's own voice (Kokoro)"? `AI_HR_SERVICE_URL`/`TOKEN` set in Vercel and identical to the host? Model status reachable? |
| No sound at all on a phone | phones only play audio started by a tap: the employee must press Answer/Call; Speaker on; captions always show |
| Speech stops after the first sentence | `aiCallSpeak` failing: Vercel function logs, rate limit `aiHrTurn` |
| Google voice option missing | intended: external TTS is off unless `AI_HR_ALLOW_EXTERNAL_TTS=1` |
| Interrupt doesn't stop her | the browser blocked `pause()`; End call always stops; report the device/browser |

## Conversations

| Symptom | Check |
|---|---|
| Naina doesn't understand a local phrase | AI HR Assistant → Escalations & review → *Answers not understood* → **Teach**; or Scenarios → custom words |
| She says she doesn't know | the answer isn't in approved knowledge: add/approve it in Knowledge; she never invents HR data |
| An employee asks for another person's data | refused by rule (`other_person_info`); all-lowercase names may get a generic answer instead (HR-CONVERSATION-SCENARIOS.md) |
| Others | DEPLOYMENT.md §6 |
