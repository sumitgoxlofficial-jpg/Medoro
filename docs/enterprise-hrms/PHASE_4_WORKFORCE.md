# Enterprise HRMS 2.0 — Phase 4: workforce event engine, devices and the Windows agent

## What is recorded, and when
Only the **process name** of the program in front and **active / idle / locked** spans, from **company PCs enrolled by HR**,
only while **tracking is switched on** (Settings → *Workforce agent*, off by default), the employee has **accepted the
policy** (versioned, append-only consent record), is **checked in**, **not on a break** and **not checked out**. The
server enforces all of this for every status call and every span: spans outside a check-in, during a break, in the future,
older than 7 days or longer than an hour are dropped and counted as `outside`. The upload schema is strict: a span with
any other field (a title, a URL…) makes the whole upload invalid. No keylogging, passwords, screenshots, titles, URLs,
messages, microphone, camera or covert mode exist anywhere in the agent or the API.

Transparency and control: the tray icon always shows whether anything is recorded and why not; *My activity* shows the
policy, the person's PCs (they can remove one), every span and per-program totals for any day, and a **dispute** form.
HR accepting a dispute excludes the window from every total (rows kept, marked). Activity is labelled context, never a
performance measure, and is not an input to any KPI (Phase 5).

## Server
* `src/staff/hrms/workforce.ts`: enrolment codes (HR, Attendance module; 15 minutes, single use, stored hashed),
  device tokens (stored as SHA-256), recording rules, ingest (idempotent per device + client id, rate-limited), day
  views, disputes, program categories, revocation, 90-day retention, signed update manifest.
* API (`src/app/api/agent/*`, bearer token, no cookies): `POST /api/agent/enrol`, `GET /api/agent/status`,
  `POST /api/agent/events` (≤500 spans; 403 with a reason when nothing may be stored), `GET /api/agent/update`
  (ECDSA P-256 signed manifest or 204). A revoked or unknown token always gets 401.
* Screens: *My activity* (employee), *Workforce devices* (HR): enrolment codes, PCs, open disputes, the team's day
  (opening a person's detail is audited) and program categories.
* Tables: `HrDevice`, `HrDeviceCode`, `HrWorkEvent`, `HrMonitorAck` (append-only), `HrActivityDispute`, `HrAppCategory`.

## Agent (`agent/`)
.NET 8. `Medoro.Agent.Core` (sessionizer, DPAPI-encrypted offline queue with atomic writes and 7-day/20k cap, HTTPS-only
client, update verification, the loop that stops recording on any doubt), `Medoro.Agent.Windows` (tray host: foreground
process name via `GetForegroundWindow`/`GetWindowThreadProcessId`, idle via `GetLastInputInfo`, lock via session events;
no hooks), `Medoro.Agent.Tests` (xUnit). See `agent/README.md`.

## Tests (actual)
* `tests/integration/hrms-workforce.test.ts` (8, against the real route handlers): codes (HR only, hashed, single use,
  expiry, bad code), every recording rule in order (tracking off → policy → not checked in → ok → break → ok), strict schema
  (title/url refused), working-time filter (before check-in, break, future, too long), de-duplication, idle spans carry
  no program, access (self, HR audited, colleague refused), dispute accept excludes minutes / reject needs a reason /
  no double decision, revocation → 401 on status and events, consent rows immutable, update manifest 204 unless configured
  and its signature verifies, retention.
* Agent: `dotnet test` **23/23** (sessionizer splits/gaps/caps/flush, process-name cleaning, encrypted queue survives
  restart and drops old spans, unreadable file set aside, HTTPS-only server, enrolment, records only when allowed,
  offline queue then sync without duplicates, stops after 30 minutes without contact, revoked device stops and forgets,
  tracking switched off discards the queue, update signature/version/host/hash checks, and **a manifest signed by the
  server's own Node code verifies in C#**).
* `dotnet publish -r win-x64` of the tray host: builds with warnings as errors (on Linux, through the WinForms
  reference pack).
* Full suite: 225 files / 1,378 tests pass; lint, typecheck pass.

**Not executed (no Windows machine here):** installation, start at sign-in, the Win32 sampler and lock events, DPAPI, the
tray UI, msiexec update hand-off, and an end-to-end run of the real agent against a server. `.github/workflows/agent.yml`
builds and tests on `windows-latest`. No MSI installer or code signing yet.
