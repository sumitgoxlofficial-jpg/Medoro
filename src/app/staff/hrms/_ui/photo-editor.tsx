"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { FlipHorizontal2, RotateCcw, RotateCw, ZoomIn, ZoomOut } from "lucide-react";
import { Modal, Tabs, btnCls, cx, primaryCls } from "./kit";

/** Every look is a mix of these. Values are offsets from neutral (0). */
type Adjust = { brightness: number; contrast: number; saturation: number; warmth: number; fade: number; vignette: number; mono: number; sepia: number };
const NEUTRAL: Adjust = { brightness: 0, contrast: 0, saturation: 0, warmth: 0, fade: 0, vignette: 0, mono: 0, sepia: 0 };

const PRESETS: { id: string; label: string; a: Partial<Adjust> }[] = [
  { id: "none", label: "Original", a: {} },
  { id: "vivid", label: "Vivid", a: { contrast: 0.18, saturation: 0.4 } },
  { id: "bright", label: "Bright", a: { brightness: 0.12, contrast: 0.05, saturation: 0.1 } },
  { id: "warm", label: "Warm", a: { warmth: 0.35, saturation: 0.1, contrast: 0.05 } },
  { id: "cool", label: "Cool", a: { warmth: -0.35, contrast: 0.08 } },
  { id: "soft", label: "Soft", a: { fade: 0.35, contrast: -0.1, brightness: 0.05, saturation: -0.1 } },
  { id: "drama", label: "Drama", a: { contrast: 0.35, saturation: -0.15, vignette: 0.45 } },
  { id: "vintage", label: "Vintage", a: { sepia: 0.45, fade: 0.25, vignette: 0.3, contrast: 0.05 } },
  { id: "mono", label: "Mono", a: { mono: 1, contrast: 0.15 } },
  { id: "noir", label: "Noir", a: { mono: 1, contrast: 0.45, brightness: -0.05, vignette: 0.5 } },
];

const SLIDERS: [keyof Adjust, string][] = [["brightness", "Brightness"], ["contrast", "Contrast"], ["saturation", "Saturation"], ["warmth", "Warmth"], ["fade", "Fade"], ["vignette", "Vignette"]];

type Crop = { zoom: number; x: number; y: number; rot: number; flip: boolean }; // x, y: shift as a fraction of the frame
const START: Crop = { zoom: 1, x: 0, y: 0, rot: 0, flip: false };
const OUT = 400; // saved photo is 400 × 400 JPEG
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** How far the picture can move before an edge shows inside the frame. */
function limits(img: { width: number; height: number }, c: Crop) {
  const [w, h] = c.rot % 180 ? [img.height, img.width] : [img.width, img.height];
  const k = c.zoom / Math.min(w, h); // frame = 1
  return { x: Math.max(0, (w * k - 1) / 2), y: Math.max(0, (h * k - 1) / 2) };
}
const fit = (img: { width: number; height: number }, c: Crop): Crop => { const l = limits(img, c); return { ...c, x: clamp(c.x, -l.x, l.x), y: clamp(c.y, -l.y, l.y) }; };

/** Draws the cropped, filtered picture into a size × size canvas. Pixel maths, so it looks the same in every browser. */
function paint(cv: HTMLCanvasElement, img: CanvasImageSource & { width: number; height: number }, c: Crop, a: Adjust, size: number) {
  cv.width = cv.height = size;
  const ctx = cv.getContext("2d", { willReadFrequently: true })!;
  const [w, h] = c.rot % 180 ? [img.height, img.width] : [img.width, img.height];
  const k = (size * c.zoom) / Math.min(w, h);
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, size, size);
  ctx.save();
  ctx.imageSmoothingQuality = "high";
  ctx.translate(size / 2 + c.x * size, size / 2 + c.y * size);
  ctx.rotate((c.rot * Math.PI) / 180);
  ctx.scale(c.flip ? -k : k, k);
  ctx.drawImage(img, -img.width / 2, -img.height / 2);
  ctx.restore();
  if (Object.values(a).every((v) => v === 0)) return;
  const d = ctx.getImageData(0, 0, size, size), px = d.data;
  const br = 1 + a.brightness, ct = 1 + a.contrast, sat = 1 + a.saturation, warm = a.warmth * 40, fade = a.fade, mono = clamp(a.mono, 0, 1), sep = clamp(a.sepia, 0, 1), vig = a.vignette;
  const half = size / 2;
  for (let i = 0; i < px.length; i += 4) {
    let r = px[i], g = px[i + 1], b = px[i + 2];
    r *= br; g *= br; b *= br;
    r = (r - 128) * ct + 128; g = (g - 128) * ct + 128; b = (b - 128) * ct + 128;
    let y = 0.299 * r + 0.587 * g + 0.114 * b;
    r = y + (r - y) * sat; g = y + (g - y) * sat; b = y + (b - y) * sat;
    r += warm; b -= warm; g += warm * 0.15;
    if (mono) { y = 0.299 * r + 0.587 * g + 0.114 * b; r += (y - r) * mono; g += (y - g) * mono; b += (y - b) * mono; }
    if (sep) {
      const sr = 0.393 * r + 0.769 * g + 0.189 * b, sg = 0.349 * r + 0.686 * g + 0.168 * b, sb = 0.272 * r + 0.534 * g + 0.131 * b;
      r += (sr - r) * sep; g += (sg - g) * sep; b += (sb - b) * sep;
    }
    if (fade) { r += (r * 0.78 + 45 - r) * fade; g += (g * 0.78 + 45 - g) * fade; b += (b * 0.78 + 45 - b) * fade; }
    if (vig) {
      const p = i / 4, dx = (p % size) - half, dy = Math.floor(p / size) - half;
      const f = 1 - vig * Math.min(1, (dx * dx + dy * dy) / (half * half)) ** 1.5 * 0.85;
      r *= f; g *= f; b *= f;
    }
    px[i] = r; px[i + 1] = g; px[i + 2] = b; // Uint8ClampedArray clamps to 0..255
  }
  ctx.putImageData(d, 0, 0);
}

const mix = (preset: string, adj: Adjust): Adjust => {
  const p = PRESETS.find((x) => x.id === preset)?.a ?? {};
  return Object.fromEntries(Object.keys(NEUTRAL).map((k) => [k, (p[k as keyof Adjust] ?? 0) + adj[k as keyof Adjust]])) as Adjust;
};

type Pic = ImageBitmap | HTMLImageElement;
async function load(file: File): Promise<Pic> {
  if (!file.type.startsWith("image/")) throw new Error("That file isn’t an image.");
  try { return await createImageBitmap(file, { imageOrientation: "from-image" }); } catch { /* older browsers */ }
  return new Promise((res, rej) => { const i = new Image(), u = URL.createObjectURL(file); i.onload = () => res(i); i.onerror = () => rej(new Error("That file isn’t an image.")); i.src = u; });
}

/** Profile photo editor: crop (drag, zoom, rotate, flip), filter looks and fine adjustments, then saves a 400 px square. */
export function PhotoEditor({ file, onCancel, onSave, busy }: { file: File; onCancel: () => void; onSave: (dataUrl: string) => void; busy?: boolean }) {
  const [img, setImg] = useState<Pic | null>(null), [err, setErr] = useState("");
  const [tab, setTab] = useState<"crop" | "filter" | "adjust">("crop");
  const [crop, setCrop] = useState<Crop>(START), [preset, setPreset] = useState("none"), [adj, setAdj] = useState<Adjust>(NEUTRAL);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const view = useRef<HTMLCanvasElement>(null), drag = useRef<{ x: number; y: number; pts: Map<number, { x: number; y: number }>; pinch: number } | null>(null);

  useEffect(() => { let live = true; load(file).then((i) => live && setImg(i)).catch((e: Error) => live && setErr(e.message)); return () => { live = false; }; }, [file]);

  const setC = useCallback((f: (c: Crop) => Crop) => setCrop((c) => (img ? fit(img, f(c)) : c)), [img]);

  // Live preview, drawn at screen resolution.
  useEffect(() => {
    if (!img || !view.current) return;
    const id = requestAnimationFrame(() => view.current && paint(view.current, img, crop, mix(preset, adj), Math.round(300 * Math.min(2, window.devicePixelRatio || 1))));
    return () => cancelAnimationFrame(id);
  }, [img, crop, preset, adj]);

  // Small previews of each look, using the current crop.
  useEffect(() => {
    if (!img || tab !== "filter") return;
    const t = setTimeout(() => {
      const cv = document.createElement("canvas"), out: Record<string, string> = {};
      for (const p of PRESETS) { paint(cv, img, crop, mix(p.id, NEUTRAL), 96); out[p.id] = cv.toDataURL("image/jpeg", 0.8); }
      setThumbs(out);
    }, 120);
    return () => clearTimeout(t);
  }, [img, crop, tab]);

  const down = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    const d = drag.current ?? { x: e.clientX, y: e.clientY, pts: new Map(), pinch: 0 };
    d.pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (d.pts.size === 2) { const [a, b] = [...d.pts.values()]; d.pinch = Math.hypot(a.x - b.x, a.y - b.y); }
    d.x = e.clientX; d.y = e.clientY; drag.current = d;
  };
  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const d = drag.current; if (!d || !d.pts.has(e.pointerId)) return;
    d.pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const w = e.currentTarget.getBoundingClientRect().width;
    if (d.pts.size >= 2) {
      const [a, b] = [...d.pts.values()], dist = Math.hypot(a.x - b.x, a.y - b.y);
      if (d.pinch) { const r = dist / d.pinch; setC((c) => ({ ...c, zoom: clamp(c.zoom * r, 1, 5) })); }
      d.pinch = dist; return;
    }
    const dx = (e.clientX - d.x) / w, dy = (e.clientY - d.y) / w; d.x = e.clientX; d.y = e.clientY;
    setC((c) => ({ ...c, x: c.x + dx, y: c.y + dy }));
  };
  const up = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const d = drag.current; if (!d) return;
    d.pts.delete(e.pointerId); d.pinch = 0;
    if (!d.pts.size) drag.current = null; else { const [p] = [...d.pts.values()]; d.x = p.x; d.y = p.y; }
  };
  const key = (e: React.KeyboardEvent) => {
    const s = 0.02, m: Record<string, [number, number]> = { ArrowLeft: [-s, 0], ArrowRight: [s, 0], ArrowUp: [0, -s], ArrowDown: [0, s] };
    if (m[e.key]) { e.preventDefault(); setC((c) => ({ ...c, x: c.x + m[e.key][0], y: c.y + m[e.key][1] })); }
    else if (e.key === "+" || e.key === "=") setC((c) => ({ ...c, zoom: clamp(c.zoom + 0.1, 1, 5) }));
    else if (e.key === "-") setC((c) => ({ ...c, zoom: clamp(c.zoom - 0.1, 1, 5) }));
  };

  // Wheel zoom needs a non-passive listener so the page doesn't scroll.
  useEffect(() => {
    const el = view.current; if (!el) return;
    const wheel = (e: WheelEvent) => { e.preventDefault(); setC((c) => ({ ...c, zoom: clamp(c.zoom * Math.exp(-e.deltaY * 0.0015), 1, 5) })); };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  }, [setC, img]);

  const save = () => {
    if (!img) return;
    const cv = document.createElement("canvas");
    paint(cv, img, crop, mix(preset, adj), OUT);
    let q = 0.88, url = cv.toDataURL("image/jpeg", q);
    while (url.length > 190_000 && q > 0.4) { q -= 0.1; url = cv.toDataURL("image/jpeg", q); }
    onSave(url);
  };
  const reset = () => { setCrop(START); setPreset("none"); setAdj(NEUTRAL); };

  return (
    <Modal title="Edit profile photo" onClose={onCancel}>
      {err ? <p role="alert" className="text-[13px] text-[#B3261E] bg-[#FDECEA] rounded-lg px-3 py-2">{err}</p> : (
        <>
          <div className="relative mx-auto w-full max-w-[300px] aspect-square rounded-xl overflow-hidden bg-[#0f172a] select-none">
            <canvas ref={view} tabIndex={0} aria-label="Photo. Drag to move, scroll or pinch to zoom, arrow keys to nudge." onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onKeyDown={key}
              className="block w-full h-full cursor-grab active:cursor-grabbing touch-none outline-none focus-visible:ring-2 focus-visible:ring-[#14B8A6]" />
            {/* Dim everything outside the round profile frame, with a thirds grid inside it. */}
            <div aria-hidden className="pointer-events-none absolute inset-0 rounded-full shadow-[0_0_0_999px_rgba(15,23,42,.55)] border-2 border-white/80" />
            {tab === "crop" ? <div aria-hidden className="pointer-events-none absolute inset-0 rounded-full overflow-hidden bg-[linear-gradient(to_right,transparent_33.1%,rgba(255,255,255,.35)_33.3%,transparent_33.5%,transparent_66.5%,rgba(255,255,255,.35)_66.7%,transparent_66.9%),linear-gradient(to_bottom,transparent_33.1%,rgba(255,255,255,.35)_33.3%,transparent_33.5%,transparent_66.5%,rgba(255,255,255,.35)_66.7%,transparent_66.9%)]" /> : null}
            {!img ? <div className="absolute inset-0 flex items-center justify-center text-white text-[13px]">Opening photo…</div> : null}
          </div>

          <div className="flex justify-center"><Tabs value={tab} options={[["crop", "Crop"], ["filter", "Filters"], ["adjust", "Adjust"]]} onChange={setTab} /></div>

          {tab === "crop" ? (
            <div className="flex flex-col gap-3">
              <label className="flex items-center gap-2 text-[12.5px] text-[#475569]">
                <button type="button" className={btnCls} aria-label="Zoom out" onClick={() => setC((c) => ({ ...c, zoom: clamp(c.zoom - 0.2, 1, 5) }))}><ZoomOut size={14} /></button>
                <input type="range" min={1} max={5} step={0.01} value={crop.zoom} onChange={(e) => setC((c) => ({ ...c, zoom: +e.target.value }))} className="flex-1 accent-[#0B5E5B]" aria-label="Zoom" />
                <button type="button" className={btnCls} aria-label="Zoom in" onClick={() => setC((c) => ({ ...c, zoom: clamp(c.zoom + 0.2, 1, 5) }))}><ZoomIn size={14} /></button>
              </label>
              <div className="flex gap-2 justify-center flex-wrap">
                <button type="button" className={btnCls} onClick={() => setC((c) => ({ ...c, rot: (c.rot + 270) % 360 }))}><RotateCcw size={14} aria-hidden />Rotate left</button>
                <button type="button" className={btnCls} onClick={() => setC((c) => ({ ...c, rot: (c.rot + 90) % 360 }))}><RotateCw size={14} aria-hidden />Rotate right</button>
                <button type="button" className={btnCls} aria-pressed={crop.flip} onClick={() => setC((c) => ({ ...c, flip: !c.flip }))}><FlipHorizontal2 size={14} aria-hidden />Flip</button>
              </div>
              <p className="text-[11.5px] text-[#64748B] text-center">Drag the photo to position it. Scroll or pinch to zoom.</p>
            </div>
          ) : null}

          {tab === "filter" ? (
            <div className="flex gap-2.5 overflow-x-auto pb-1 -mx-1 px-1">
              {PRESETS.map((p) => (
                <button key={p.id} type="button" onClick={() => setPreset(p.id)} aria-pressed={preset === p.id} className="flex flex-col items-center gap-1 flex-none bg-transparent border-0 cursor-pointer p-0">
                  <span className={cx("block w-[64px] h-[64px] rounded-full overflow-hidden border-[3px] bg-[#E2E8F0]", preset === p.id ? "border-[#0B5E5B]" : "border-transparent")}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    {thumbs[p.id] ? <img src={thumbs[p.id]} alt="" className="w-full h-full object-cover" /> : null}
                  </span>
                  <span className={cx("text-[11.5px]", preset === p.id ? "font-bold text-[#0B5E5B]" : "text-[#475569]")}>{p.label}</span>
                </button>
              ))}
            </div>
          ) : null}

          {tab === "adjust" ? (
            <div className="grid gap-2.5">
              {SLIDERS.map(([k, l]) => (
                <label key={k} className="grid grid-cols-[88px_1fr_36px] items-center gap-2 text-[12.5px] text-[#475569]">
                  <span>{l}</span>
                  <input type="range" min={k === "fade" || k === "vignette" ? 0 : -1} max={1} step={0.01} value={adj[k]} onChange={(e) => setAdj((a) => ({ ...a, [k]: +e.target.value }))} onDoubleClick={() => setAdj((a) => ({ ...a, [k]: 0 }))} className="accent-[#0B5E5B]" />
                  <span className="text-right tabular-nums text-[11.5px]">{Math.round(adj[k] * 100)}</span>
                </label>
              ))}
              <p className="text-[11.5px] text-[#64748B]">Double-click a slider to reset it.</p>
            </div>
          ) : null}
        </>
      )}
      <div className="flex gap-2 flex-wrap">
        <button type="button" className={btnCls} onClick={reset} disabled={!img}>Reset</button>
        <button type="button" className={`${btnCls} ml-auto`} onClick={onCancel}>Cancel</button>
        <button type="button" className={primaryCls} onClick={save} disabled={!img || busy}>{busy ? "Saving…" : "Save photo"}</button>
      </div>
    </Modal>
  );
}
