// Builds the homepage's live product tour (public/tour/) from the design prototype `design/Medoro App.dc.html`.
//
//   node scripts/build-tour.mjs
//
// The prototype normally pulls React, Google Fonts and the Lucide icon font from CDNs. The site's CSP allows none of
// that, so everything is served from our own origin: React and Lucide from design/vendor/, IBM Plex from @fontsource.
// /tour/ gets its own sandboxed CSP in src/server/security-headers.ts.
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const design = join(root, "design");
const vendor = join(design, "vendor");
const out = join(root, "public", "tour");
const fontsource = join(root, "node_modules", "@fontsource");

rmSync(out, { recursive: true, force: true });
for (const d of ["", "vendor", "fonts", "assets"]) mkdirSync(join(out, d), { recursive: true });

// ── Prototype runtime, React and the logo ──
copyFileSync(join(design, "support.js"), join(out, "support.js"));
for (const f of ["react.production.min.js", "react-dom.production.min.js", "lucide.woff2"]) copyFileSync(join(vendor, f), join(out, "vendor", f));
copyFileSync(join(design, "assets", "medoro-mark.png"), join(out, "assets", "medoro-mark.png"));

// Point the runtime's CDN URLs at our copies. A defined __resources also skips the runtime's re-fetch of its own page.
writeFileSync(join(out, "resources.js"), `window.__resources = ${JSON.stringify({
  "https://unpkg.com/react@18.3.1/umd/react.production.min.js": "vendor/react.production.min.js",
  "https://unpkg.com/react-dom@18.3.1/umd/react-dom.production.min.js": "vendor/react-dom.production.min.js",
}, null, 2)};\n`);

// ── Fonts: the weights the prototype uses, latin and devanagari subsets ──
const FONTS = [
  ["ibm-plex-sans", "IBM Plex Sans", [400, 500, 600, 700], ["latin"]],
  ["ibm-plex-sans-devanagari", "IBM Plex Sans Devanagari", [400, 500, 600], ["devanagari", "latin"]],
  ["ibm-plex-mono", "IBM Plex Mono", [400, 500], ["latin"]],
];
let fontCss = "";
for (const [pkg, family, weights, subsets] of FONTS) {
  for (const w of weights) {
    // Take the unicode-range for each subset from fontsource's own stylesheet.
    const css = readFileSync(join(fontsource, pkg, `${w}.css`), "utf8");
    for (const s of subsets) {
      const file = `${pkg}-${s}-${w}-normal.woff2`;
      const block = css.split("@font-face").find((b) => b.includes(file));
      if (!block) throw new Error(`No @font-face for ${file}`);
      const range = /unicode-range:\s*([^;]+);/.exec(block)?.[1];
      copyFileSync(join(fontsource, pkg, "files", file), join(out, "fonts", file));
      fontCss += `@font-face{font-family:'${family}';font-style:normal;font-display:swap;font-weight:${w};src:url(fonts/${file}) format('woff2');${range ? `unicode-range:${range};` : ""}}\n`;
    }
  }
}
writeFileSync(join(out, "fonts.css"), fontCss);

// ── Icons: only the Lucide glyphs the prototype names ──
let html = readFileSync(join(design, "Medoro App.dc.html"), "utf8");
const codepoints = JSON.parse(readFileSync(join(vendor, "lucide-codepoints.json"), "utf8"));
const used = new Set();
for (const m of html.matchAll(/icon-([a-z0-9-]+)/g)) used.add(m[1]);
// Icon names also travel as plain string data (e.g. `icon: 'truck'`) and are joined to "icon-" at render time.
for (const m of html.matchAll(/['"]([a-z][a-z0-9-]*)['"]/g)) if (m[1] in codepoints) used.add(m[1]);
const icons = [...used].filter((n) => n in codepoints).sort();
const missing = [...html.matchAll(/class="icon-([a-z0-9-]+)"/g)].map((m) => m[1]).filter((n) => !(n in codepoints));
if (missing.length) throw new Error(`Lucide has no glyph for: ${[...new Set(missing)].join(", ")}`);
writeFileSync(join(out, "icons.css"),
  `@font-face{font-family:'lucide';src:url(vendor/lucide.woff2) format('woff2');font-display:block}\n` +
  `[class^="icon-"],[class*=" icon-"]{font-family:'lucide'!important;font-style:normal;-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale}\n` +
  icons.map((n) => `.icon-${n}::before{content:"\\${codepoints[n].toString(16)}"}`).join("\n") + "\n");

// ── The page ──
const swap = (from, to) => {
  if (!html.includes(from)) throw new Error(`Prototype no longer contains: ${from}`);
  html = html.split(from).join(to);
};
swap('<script src="./support.js"></script>', '<title>Medoro product tour</title>\n<script src="resources.js"></script>\n<script src="support.js"></script>');
html = html.replace(/<link rel="preconnect" href="https:\/\/fonts\.googleapis\.com">\n?/, "");
html = html.replace(/<link href="https:\/\/fonts\.googleapis\.com\/css2[^"]*" rel="stylesheet">/, '<link href="fonts.css" rel="stylesheet">');
html = html.replace(/<link href="https:\/\/cdn\.jsdelivr\.net\/npm\/lucide-static@[^"]*" rel="stylesheet">/, '<link href="icons.css" rel="stylesheet">');
const external = html.match(/(?:src|href)="https?:\/\/[^"]+"/g);
if (external) throw new Error(`Prototype still loads from other origins: ${external.join(", ")}`);
writeFileSync(join(out, "index.html"), html);

if (!existsSync(join(out, "index.html"))) throw new Error("tour not written");
console.log(`public/tour: ${icons.length} icons, ${fontCss.split("\n").length - 1} font faces`);
