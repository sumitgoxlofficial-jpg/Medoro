# Medoro desktop

A small [Tauri 2](https://tauri.app) app that opens your pharmacy's Medoro server in its own window. It stores only the server address; all data stays on your server.

- First start: enter the server address (e.g. `https://medoro.yourpharmacy.in`). Next starts connect automatically; click the address box within a second to change it.
- Server unreachable: the start page says so and, if this counter has offline billing turned on, offers **Open offline billing**.
- Pages from the server get no access to the computer (the Tauri capability covers only the bundled start page).

## Build
Installers are built in CI by `.github/workflows/desktop.yml` (Windows `.msi`/`.exe`, macOS universal `.dmg`, Linux `.deb`/`.AppImage`). Push a tag `desktop-v1.0.0` to draft a release with them.

Locally (needs Rust and, on Linux, `libwebkit2gtk-4.1-dev librsvg2-dev libayatana-appindicator3-dev libxdo-dev libssl-dev`):

```bash
cd desktop
npm install
npm run build        # installers in src-tauri/target/release/bundle
npm run icons        # regenerate icons from public/icons/icon-512.png
```

Code signing (Windows Authenticode, Apple notarisation) is not set up yet; unsigned installers show a warning on first run.
