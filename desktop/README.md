# Medoro desktop

A small [Tauri 2](https://tauri.app) app that opens your pharmacy's Medoro server in its own window. It stores only the server address; all data stays on your server.

- First start: enter the server address (e.g. `https://medoro.yourpharmacy.in`). Next starts connect automatically; click the address box within a second to change it.
- **Change server…** (menu *Medoro*, or **Ctrl+Shift+S** / **⌘⇧S**) goes back to the start page with the saved address filled in.
- Server unreachable: the start page says so and offers **Try again**, **Change server** and, if this counter has offline billing turned on, **Open offline billing**. If the server stops answering later and a page can't load, the app returns to the start page instead of showing a blank or error page (offline billing pages stay put).
- **Check for updates…** (menu *Medoro*); the app also checks once at launch.

## Security model
- Only the start page bundled in the app can talk to the app (one command: tell it which server to open). The capability in `src-tauri/capabilities/default.json` is local-only, so pages from the server — or anything else on the internet — get no IPC access.
- The window only navigates to the bundled start page, the chosen server (same host name, so an `http` → `https` redirect works) and `accounts.google.com` (Google sign-in for Drive backups). Pop-ups from the server (invoice and PO printing) open in a new window; other links (`wa.me`, `mailto:`, `tel:`) open in the system browser or app.
- The start page's CSP allows scripts and styles from the app only; it may contact any `http(s)` address because it has to check the address you type.

## Offline billing on macOS
Offline billing comes from the server's service worker. Windows (WebView2, Chromium) and Linux (WebKitGTK) run service workers for an `https` server, so offline billing works in the app exactly as in a browser. On macOS the app uses Apple's WKWebView, which does not run service workers for arbitrary websites: WebKit enables them in embedded web views only for *App-Bound Domains* fixed in the app's `Info.plist` at build time (at most 10) or for apps holding the browser entitlement (see [WebKit bug 206741](https://bugs.webkit.org/show_bug.cgi?id=206741), [App-Bound Domains](https://webkit.org/blog/10882/app-bound-domains/), [wry#389](https://github.com/tauri-apps/wry/issues/389)). Each pharmacy has its own server address, so neither applies. The Mac app therefore hides **Open offline billing** and shows a note: for offline billing on a Mac, open the server in Chrome or Edge and install it from the address bar.

## Build
Installers are built in CI by `.github/workflows/desktop.yml` (Windows `.msi`/`.exe`, macOS universal `.dmg`, Linux `.deb`/`.AppImage`). Push a tag `desktop-v1.0.0` to draft a release with them; publish the draft to make it the update everyone receives.

Locally (needs Rust and, on Linux, `libwebkit2gtk-4.1-dev librsvg2-dev libayatana-appindicator3-dev libxdo-dev libssl-dev libgtk-3-dev`):

```bash
cd desktop
npm install
npm run build        # installers in src-tauri/target/release/bundle
npm run icons        # regenerate icons from public/icons/icon-512.png
```

## Auto-updates
The app uses `tauri-plugin-updater` and reads `https://github.com/sumitgoxlofficial-jpg/Medoro/releases/latest/download/latest.json` (the newest *published*, non-draft release). Updates are signed with a key pair you create once:

1. Generate the keys (keep the private key and its password safe; losing them means existing installs can't be updated):
   ```bash
   cd desktop
   npx tauri signer generate -w ~/.tauri/medoro.key
   ```
2. Put the **public** key (contents of `~/.tauri/medoro.key.pub`) in `src-tauri/tauri.conf.json` → `plugins.updater.pubkey`, replacing `REPLACE_WITH_TAURI_SIGNER_PUBLIC_KEY`. (Alternatively set it as the repository **variable** `TAURI_UPDATER_PUBKEY`; CI uses it to override the file.) While the placeholder is in place the app skips update checks.
3. Add the repository **secrets** `TAURI_SIGNING_PRIVATE_KEY` (contents of `~/.tauri/medoro.key`) and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.
4. For each release bump `version` in `src-tauri/tauri.conf.json` (and `Cargo.toml`/`package.json`), push tag `desktop-vX.Y.Z`, then publish the drafted release. CI uploads `latest.json` and the `.sig` files only when the private key secret is set.

## Code signing
Without these secrets the installers are built unsigned (Windows SmartScreen and macOS Gatekeeper warn on first run). Add them under *Settings → Secrets and variables → Actions → Secrets*.

**Windows — option A: Authenticode certificate (`.pfx`)**

| Secret | Value |
| --- | --- |
| `WINDOWS_CERTIFICATE` | the `.pfx` file, base64: `[Convert]::ToBase64String([IO.File]::ReadAllBytes("cert.pfx"))` |
| `WINDOWS_CERTIFICATE_PASSWORD` | the `.pfx` password |

**Windows — option B: Azure Trusted Signing** (used only when option A's secrets are absent)

| Secret | Value |
| --- | --- |
| `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET` | an app registration with the *Trusted Signing Certificate Profile Signer* role |
| `AZURE_TRUSTED_SIGNING_ENDPOINT` | e.g. `https://eus.codesigning.azure.net` |
| `AZURE_TRUSTED_SIGNING_ACCOUNT` | the Trusted Signing account name |
| `AZURE_TRUSTED_SIGNING_PROFILE` | the certificate profile name |

**macOS — signing and notarisation**

| Secret | Value |
| --- | --- |
| `APPLE_CERTIFICATE` | *Developer ID Application* certificate exported as `.p12`, base64: `base64 -i cert.p12` |
| `APPLE_CERTIFICATE_PASSWORD` | the `.p12` export password |
| `APPLE_SIGNING_IDENTITY` | e.g. `Developer ID Application: Your Company (TEAMID)` |
| `APPLE_ID` | Apple ID email used for notarisation |
| `APPLE_PASSWORD` | an [app-specific password](https://support.apple.com/102654) for that Apple ID |
| `APPLE_TEAM_ID` | your 10-character Team ID |

Signing needs the first three; notarisation additionally needs the last three.
