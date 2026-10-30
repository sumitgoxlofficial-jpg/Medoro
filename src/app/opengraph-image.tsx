import { readFile } from "node:fs/promises";
import path from "node:path";
import { ImageResponse } from "next/og";

export const alt = "Medoro: pharmacy billing, batch stock and GST for Indian medical stores";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const font = (pkg: string, file: string) => readFile(path.join(process.cwd(), "node_modules", "@fontsource", pkg, "files", file));

export default async function OpengraphImage() {
  const [cond, sans, mono, monoExt, mark] = await Promise.all([
    font("ibm-plex-sans-condensed", "ibm-plex-sans-condensed-latin-700-normal.woff"),
    font("ibm-plex-sans", "ibm-plex-sans-latin-400-normal.woff"),
    font("ibm-plex-mono", "ibm-plex-mono-latin-500-normal.woff"),
    font("ibm-plex-mono", "ibm-plex-mono-latin-ext-500-normal.woff"),
    readFile(path.join(process.cwd(), "public", "site", "mark.png")),
  ]);
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", background: "#fff", padding: "64px 72px", fontFamily: "Plex Sans", color: "#0E1614", borderTop: "12px solid #0B5E5B" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`data:image/png;base64,${mark.toString("base64")}`} width={64} height={52} alt="" />
          <div style={{ display: "flex", fontFamily: "Plex Cond", fontSize: 44 }}><span style={{ color: "#0B3A78" }}>Med</span><span style={{ color: "#0A8A73" }}>oro</span></div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", fontFamily: "Plex Cond", fontSize: 84, lineHeight: 1.02, letterSpacing: "-0.01em" }}>
          <span>Bill faster.</span>
          <span style={{ color: "#0B5E5B" }}>Waste less stock.</span>
          <span>Close GST on time.</span>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", fontSize: 26, color: "#36403E" }}>
          <span>Pharmacy software for Indian medical stores</span>
          <span style={{ fontFamily: "Plex Mono, Plex Mono Ext", color: "#0E1614" }}>14 days free · from ₹999/mo</span>
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [
        { name: "Plex Cond", data: cond, weight: 700, style: "normal" },
        { name: "Plex Sans", data: sans, weight: 400, style: "normal" },
        { name: "Plex Mono", data: mono, weight: 500, style: "normal" },
        { name: "Plex Mono Ext", data: monoExt, weight: 500, style: "normal" },
      ],
    },
  );
}
