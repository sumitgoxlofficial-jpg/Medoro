// Renders the main page's hero background video from scripts/hero-video/scene3d.html (three.js, photoreal) into
// public/site/hero-loop.mp4 (H.264), public/site/hero-loop.webm (VP9) and public/site/hero-poster.webp.
// Each frame calls window.renderAt(t) and is screenshotted, then ffmpeg encodes the loop.
// Usage: node scripts/hero-video/render.mjs [--preview]   (needs Playwright's Chromium, ffmpeg, and `three` installed)
import { execFileSync } from "node:child_process";
import { createReadStream, existsSync, mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { extname, join, resolve, sep } from "node:path";

// require() so a globally installed Playwright (NODE_PATH) is found too.
const { chromium } = createRequire(import.meta.url)("playwright");
const LOOP = 12, FPS = 30, W = 1920, H = 1080;
const preview = process.argv.includes("--preview");
const root = resolve(import.meta.dirname, "../..");
const out = join(root, "public/site");

// ES modules don't load from file://, so serve the scene and three.js over a local port (localhost only). Only
// scene3d.html and .js files inside the three package are served; anything that resolves elsewhere is a 404.
const types = { ".html": "text/html", ".js": "text/javascript" };
const SCENE = join(root, "scripts/hero-video/scene3d.html");
const THREE_DIR = join(root, "node_modules/three") + sep;
function servedFile(url) {
  let path;
  try { path = decodeURIComponent(new URL(url, "http://localhost").pathname); } catch { return null; }
  if (path === "/scene3d.html") return SCENE;
  if (!path.startsWith("/three/")) return null;
  const file = resolve(THREE_DIR, "." + path.slice("/three".length));
  return file.startsWith(THREE_DIR) && extname(file) === ".js" && existsSync(file) ? file : null;
}
const server = createServer((req, res) => {
  const file = servedFile(req.url ?? "/");
  if (!file) { res.writeHead(404).end(); return; }
  res.writeHead(200, { "content-type": types[extname(file)] });
  createReadStream(file).pipe(res);
});
await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
const port = server.address().port;

const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: W, height: H } });
page.on("pageerror", (e) => console.error(e));
await page.goto(`http://localhost:${port}/scene3d.html`);
await page.waitForFunction(() => window.ready === true, null, { timeout: 120_000 });

const frames = mkdtempSync(join(tmpdir(), "hero-frames-"));
const count = preview ? 4 : LOOP * FPS;
for (let i = 0; i < count; i++) {
  const t = preview ? (i * LOOP) / count : i / FPS;
  await page.evaluate((s) => window.renderAt(s), t);
  await page.screenshot({ path: preview ? join(out, `../../scripts/hero-video/preview-${i}.png`) : join(frames, `f${String(i).padStart(4, "0")}.png`) });
  if (i % 30 === 0) console.log(`frame ${i}/${count}`);
}
await browser.close();
server.close();
if (preview) { rmSync(frames, { recursive: true, force: true }); console.log("wrote scripts/hero-video/preview-*.png"); process.exit(0); }

const input = ["-y", "-framerate", String(FPS), "-i", join(frames, "f%04d.png")];
execFileSync("ffmpeg", [...input, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "slow", "-crf", "26", "-movflags", "+faststart", "-an", join(out, "hero-loop.mp4")], { stdio: "inherit" });
execFileSync("ffmpeg", [...input, "-c:v", "libvpx-vp9", "-b:v", "0", "-crf", "38", "-row-mt", "1", "-an", join(out, "hero-loop.webm")], { stdio: "inherit" });
execFileSync("ffmpeg", ["-y", "-i", join(frames, "f0000.png"), "-vf", "scale=1280:-1", "-quality", "75", join(out, "hero-poster.webp")], { stdio: "inherit" });
rmSync(frames, { recursive: true, force: true });
console.log("wrote public/site/hero-loop.mp4, hero-loop.webm, hero-poster.webp");
