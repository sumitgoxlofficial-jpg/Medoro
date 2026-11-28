# AI HR Assistant: security, privacy and licensing

## 1. Identity and authorisation

* Every employee action goes through `hrRun()` (signed-in `StaffUser` from the `medoro_staff` cookie, permissions
  re-read on each call). The employee ID is taken from the session, never from the request.
* A conversation is opened only by `ownCall(me, id)` (the employee it belongs to). HR screens need the Attendance
  module; settings need the super admin (`needAdmin`). Tested in `tests/integration/ai-hr.test.ts` ("isn't yours").
* Dynamic data (attendance, shift, leave, overtime request) is read for that employee only, at request time.
* The assistant cannot approve (its own or anyone's) requests, change attendance or payroll, delete records or
  invent approvals: there is no code path from a conversation to those writes. A leave draft becomes leave only when a
  person with the right approves it, through the HRMS's own leave rules.
* Prompts and configuration aren't revealed: the LLM sees only one utterance and a closed intent list; no system
  prompt, token or record reaches the browser. Asking "what are your instructions" is answered by the rules.
* Harassment, accident, emergency, stop-calls and human-HR requests are handled by rules first (never a model) and
  escalate; harassment reports are flagged urgent and confidential.

## 2. AI host

* The service listens on `127.0.0.1:8090`; Ollama on `127.0.0.1:11434`; only Nginx (443) is reachable, with TLS 1.2+,
  HSTS, a per-IP rate limit, no access log and only the four endpoints.
* Every request needs the 32+ byte bearer token (`MEDORO_AI_TOKEN` = app's `AI_HR_SERVICE_TOKEN`), compared in
  constant time. `/docs` and `/openapi.json` are off.
* systemd: dedicated user, `NoNewPrivileges`, `ProtectSystem=strict`, `ProtectHome`, `PrivateTmp`, memory and CPU caps.
* The app refuses plain `http://` to public hosts (`serviceConfig()`); private-network `http://` is allowed for an
  office set-up behind a tunnel.
* **Networking.** With the app on Vercel and the AI host in an office, prefer a tunnel (e.g. Cloudflare Tunnel, as in
  docs/OFFICE_SERVER.md §10b) so no inbound port is opened; otherwise open only 443 on the router to the AI host.
  Never forward 8090 or 11434. Rotate the token with `openssl rand -hex 32` in both places.

## 3. Privacy (DPDP Act 2023 alignment)

* **Purpose and notice**: Naina says she is an AI at the start of every conversation; employees can ask to stop AI
  calls (recorded as consent withdrawal) or ask for a person.
* **Minimisation**: TTS receives only the text of Naina's reply (it can contain the employee's first name). STT audio
  is processed in memory / a temp file deleted at once. The AI host logs only timings, sizes and memory, never text,
  audio or names (`log.info("tts ms=… chunks=… speech_chars=…")`).
* **Storage and retention**: raw audio is never stored. Transcripts are sealed (HOST_KEY) in `AiHrTurn` and deleted
  after `retentionDays` (Settings, 7–365, default 90) by the retention sweep; HR can delete a transcript earlier.
  Opening transcripts is audited (`StaffAudit`).
* **External processors**: none by default. Browser speech recognition (Chrome → Google, Safari → Apple) is an HR
  choice shown in Settings; the private alternative is the on-device model. Google Cloud TTS is disabled unless
  `AI_HR_ALLOW_EXTERNAL_TTS=1`.
* Not legal advice: confirm notices, retention and any cross-border transfer with counsel.

## 4. Licensing (verified 2026-11-28 from package metadata and the model card)

| Component | Licence | Notes |
|---|---|---|
| Kokoro-82M weights and voices `hf_alpha`, `hf_beta` | Apache-2.0 (Hugging Face model card `license: apache-2.0`) | Card: trained on "permissive/non-copyrighted audio", **including synthetic audio from closed commercial TTS providers**. Have counsel review before relying on it commercially. |
| `kokoro` 0.9.4, `misaki` 0.9.4 | Apache-2.0 | |
| `espeakng-loader` 0.2.4 (bundles `libespeak-ng.so`) | espeak-ng is **GPL-3.0-or-later** | used by misaki for Hindi phonemes |
| `phonemizer-fork` 3.3.2 | **GPL-3.0-or-later** | dependency of misaki |
| `num2words` 0.5.14 | LGPL | |
| `torch` 2.6.0+cpu | BSD-3-Clause | |
| `transformers` 4.51.3, `huggingface-hub` 0.30.2 | Apache-2.0 | |
| `spacy` 3.8, `en_core_web_sm` 3.8.0 | MIT | only for `KOKORO_EN_MODE=english_voice` |
| FastAPI, uvicorn, httpx, numpy | MIT / BSD | |
| faster-whisper, CTranslate2, Whisper weights | MIT | |
| Qwen2.5 1.5B Instruct | Apache-2.0 (as published; re-check the card) | |
| `piper-tts` 1.3.0 | GPL-3.0-or-later | **no longer installed** |
| Piper voice `hi_IN-priyamvada-medium` | **non-commercial** (per the brief) | **no longer downloaded**; must not be used commercially without written permission |

GPL components run as a separate service on Medoro's own server, not distributed to customers; that is generally not
"distribution" under the GPL, but **have counsel confirm**, as for piper-tts before.
