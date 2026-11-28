# Medoro Workforce Agent (Windows)

A small tray program for **company** Windows PCs. While the employee is checked in to the Medoro HRMS and not on a
break, and only after they accept the policy in *My activity*, it sends:

* the **process name** of the program in front (for example `EXCEL`, `chrome`), and
* whether the person is **active**, **idle** (no keyboard or mouse input for the idle time set in Settings) or has the
  screen **locked**.

It never reads or sends keystrokes, passwords, screenshots, window titles, website addresses, documents, the clipboard,
messages, the microphone, the camera or location. It installs no keyboard or mouse hooks: idle time comes from the single
"last input" timestamp Windows keeps. The server rejects any upload carrying a field other than the five above.

The tray icon is visible whenever the agent runs. Its menu says whether anything is being recorded and why not
(tracking off, policy not accepted, not checked in, checked out, on a break), and opens the employee's *My activity*,
where they see everything recorded about them and can dispute it.

## Layout

| Path | What |
|---|---|
| `src/Medoro.Agent.Core` | Cross-platform logic: sessions (samples → spans), encrypted offline queue, API client, update verification, the agent loop. |
| `src/Medoro.Agent.Windows` | The Windows tray host: Win32 sampling (foreground process, last input, lock), DPAPI, enrolment dialog, updater. |
| `tests/Medoro.Agent.Tests` | xUnit tests of the core (run on Linux or Windows). |

## Build and test

```bash
dotnet test agent/tests/Medoro.Agent.Tests
dotnet publish agent/src/Medoro.Agent.Windows -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -o agent/publish
```

CI: `.github/workflows/agent.yml` builds and tests on `windows-latest` and keeps the published program as an artifact.

## Install and enrol

1. Copy `MedoroAgent.exe` and `agent.settings.json` to `%LOCALAPPDATA%\Programs\Medoro Agent\` on the PC (or deploy with
   your device management). Set `serverUrl` in `agent.settings.json` to your Medoro address (HTTPS).
2. Start it at sign-in: a shortcut in `shell:startup`, or the `HKCU\Software\Microsoft\Windows\CurrentVersion\Run` value.
3. HR opens **HRMS → Workforce devices**, picks the employee and creates an enrolment code (single use, 15 minutes).
4. On the PC: tray icon → *Enrol this PC…* → enter the code. The device token is stored DPAPI-sealed for that Windows user.
5. The super admin switches on **Settings → Workforce agent** (off by default) once the team has been told; each employee
   accepts the policy in **My activity**.

Revocation: the employee (My activity) or HR (Workforce devices) removes the PC. The agent's next contact gets `401`; it
deletes its token and anything queued and stops.

## Offline

Spans are kept in `%LOCALAPPDATA%\Medoro\Agent\queue.bin`, DPAPI-encrypted, written atomically, for at most 7 days and
20,000 spans; they are sent when Medoro can be reached again (each has an id, so a resend is never counted twice). The
server still checks every span against that day's check-in and breaks. Without contact for 30 minutes the agent stops
recording new spans.

## Updates

Updates install only when all of these hold: the server's manifest is signed with Medoro's update key (ECDSA P-256 /
SHA-256; the public key is `updatePublicKey` in `agent.settings.json`, empty = updates disabled), the version is newer,
the file is on the same HTTPS host, and its SHA-256 matches the signed manifest. Server side, set
`AGENT_UPDATE_VERSION`, `AGENT_UPDATE_URL`, `AGENT_UPDATE_SHA256` and `AGENT_UPDATE_SIGNING_KEY` (PKCS#8 DER, base64).
Make a key pair with:

```bash
node -e 'const c=require("crypto");const k=c.generateKeyPairSync("ec",{namedCurve:"P-256"});console.log("AGENT_UPDATE_SIGNING_KEY="+k.privateKey.export({format:"der",type:"pkcs8"}).toString("base64"));console.log("updatePublicKey="+k.publicKey.export({format:"der",type:"spki"}).toString("base64"))'
```

Sign the MSI with your Authenticode certificate as well; Windows Installer checks it.

## End-to-end check against a real server

`agent/tests/Medoro.Agent.E2E` drives the real core (enrolment, server rules, sessionizer, encrypted queue, upload) against
a running Medoro: `dotnet run --project agent/tests/Medoro.Agent.E2E -- http://localhost:3000 <code>`. Run on 2026-11-28
against the production build: enrolled, status `ok`, five sampled minutes stored as EXCEL 160 s, chrome 80 s, OUTLOOK 60 s,
queue empty afterwards.

## Not done yet (needs a Windows machine)

* An MSI/MSIX installer (WiX) and code signing. Today the program is copied and started as above.
* Tests that run on Windows itself: installing, sign-in start-up, the Win32 sampler, lock detection, DPAPI and the tray.
  The core logic, the API contract and the update signature format are tested on every build; the Windows host compiles
  in CI but has not been run on a real PC from this repository.
