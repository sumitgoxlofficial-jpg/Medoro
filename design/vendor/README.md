# Vendored files for the homepage product tour

`scripts/build-tour.mjs` turns `design/Medoro App.dc.html` into the live product tour at `public/tour/`.
The site's CSP allows no third-party scripts or fonts, so these come from npm and are served from our own origin:

| File | Source |
| --- | --- |
| `react.production.min.js` | `react@18.3.1/umd` |
| `react-dom.production.min.js` | `react-dom@18.3.1/umd` |
| `lucide.woff2`, `lucide-codepoints.json` | `lucide-static@1.67.0/font` |
