"use client";
// The parts of an e-signature shared by the candidate's offer page and the employee's joining letters in the HRMS: the handwriting styles
// (served from this site), the drawing pad, the disclosure with the Indian law behind signing electronically, and the form styles.
import { useEffect, useRef } from "react";
import "@fontsource/great-vibes/400.css";
import "@fontsource/dancing-script/600.css";
import "@fontsource/allura/400.css";

export const input = "w-full border border-[#CBD5E1] rounded-md px-3 py-2.5 text-[14px] bg-white focus:outline-none focus:border-[#0B5E5B] focus:ring-2 focus:ring-[#0B5E5B]/15 disabled:bg-[#F8FAFC]";
export const primary = "inline-flex items-center justify-center gap-2 rounded-md bg-[#0B5E5B] text-white font-semibold px-5 py-2.5 text-[14px] disabled:opacity-45 disabled:cursor-not-allowed hover:bg-[#094c4a] transition-colors";
export const plain = "inline-flex items-center justify-center gap-2 rounded-md border border-[#CBD5E1] bg-white text-[#0f172a] font-semibold px-4 py-2 text-[13.5px] disabled:opacity-45 hover:bg-[#F8FAFC] transition-colors";
export const label = "text-[12px] font-semibold text-[#334155] uppercase tracking-[.06em]";
export const FONTS = [
  { label: "Great Vibes", css: "'Great Vibes', cursive", size: 40 },
  { label: "Dancing Script", css: "'Dancing Script', cursive", size: 34, weight: "600" },
  { label: "Allura", css: "Allura, cursive", size: 42 },
];
export const dateIN = (iso: string) => new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" });
export const initials = (n: string) => n.trim().split(/\s+/).map((w) => w[0]?.toUpperCase() ?? "").join("").slice(0, 4);

export async function typedPng(text: string, f: (typeof FONTS)[number]) {
  try { await document.fonts.load(`${f.weight ?? "400"} 80px ${f.css}`); } catch { /* the fallback cursive font is used */ }
  const c = document.createElement("canvas"); c.width = 600; c.height = 200;
  const x = c.getContext("2d")!;
  let size = 96;
  do { x.font = `${f.weight ?? "400"} ${size}px ${f.css}`; size -= 4; } while (x.measureText(text).width > 550 && size > 28);
  x.fillStyle = "#0A1A3A"; x.textAlign = "center"; x.textBaseline = "middle"; x.fillText(text, 300, 108);
  return c.toDataURL("image/png");
}

/** A box to sign in with a finger, stylus or mouse. */
export function Pad({ onChange }: { onChange: (png: string | null) => void }) {
  const ref = useRef<HTMLCanvasElement>(null), last = useRef<{ x: number; y: number } | null>(null), strokes = useRef(0);
  useEffect(() => {
    const c = ref.current!, r = c.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    c.width = r.width * dpr; c.height = r.height * dpr;
    const g = c.getContext("2d")!; g.scale(dpr, dpr); g.lineWidth = 2.6; g.lineCap = "round"; g.lineJoin = "round"; g.strokeStyle = "#0A1A3A";
  }, []);
  const at = (e: React.PointerEvent) => { const r = ref.current!.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  const out = () => {
    const o = document.createElement("canvas"); o.width = 600; o.height = 200;
    o.getContext("2d")!.drawImage(ref.current!, 0, 0, 600, 200);
    onChange(strokes.current > 3 ? o.toDataURL("image/png") : null);
  };
  return (
    <div className="relative">
      <canvas ref={ref} aria-label="Draw your signature here" className="w-full h-[170px] rounded-md bg-white border border-[#CBD5E1] touch-none cursor-crosshair"
        onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); last.current = at(e); }}
        onPointerMove={(e) => { if (!last.current) return; const p = at(e), g = ref.current!.getContext("2d")!; g.beginPath(); g.moveTo(last.current.x, last.current.y); g.lineTo(p.x, p.y); g.stroke(); last.current = p; strokes.current++; }}
        onPointerUp={() => { last.current = null; out(); }} onPointerCancel={() => { last.current = null; }} />
      <div className="absolute left-5 right-5 bottom-10 border-b border-[#94A3B8] pointer-events-none" aria-hidden><span className="absolute -top-5 left-0 text-[18px] text-[#94A3B8]">×</span></div>
      <button type="button" className="absolute top-2 right-3 text-[12.5px] text-[#0B5E5B] font-semibold" onClick={() => { const c = ref.current!; c.getContext("2d")!.clearRect(0, 0, c.width, c.height); strokes.current = 0; onChange(null); }}>Clear</button>
    </div>
  );
}

/** The Electronic Records and Signature Disclosure, with the Indian law behind signing electronically. */
export function Disclosure({ company, what = "offer" }: { company: string; what?: "offer" | "letter" }) {
  const offer = what === "offer";
  const items: [string, string][] = [
    ["Agreement to use electronic records", offer ? `${company} would like to provide this offer to you, and receive your acceptance, electronically. If you agree, the offer letter, its annexures and your signed copy will be provided to you as electronic records, and your electronic signature will be used to record your acceptance.` : `${company} would like you to sign your joining documents electronically. If you agree, the letter and your signed copy will be provided to you as electronic records, and your electronic signature will be used to record your agreement to its terms.`],
    ["Legal effect under Indian law", `Under section 10A of the Information Technology Act, 2000, a contract is not unenforceable merely because electronic means were used to communicate the proposal and its acceptance. ${offer ? "An offer of employment is" : "A letter of appointment and a non-disclosure agreement are"} not among the documents excluded by the First Schedule to that Act. Your acceptance forms a contract under the Indian Contract Act, 1872 on the terms of the ${offer ? "letter" : "document"}.`],
    ["Type of signature", `You will sign with a simple electronic signature: your name in a signature style, or a signature drawn on screen, ${offer ? "after confirming your identity with a one-time code sent to your email" : "while signed in to your own HRMS account"}. It is not an Aadhaar eSign or a Digital Signature Certificate under section 3A of the Information Technology Act, 2000.`],
    ["Evidence and audit trail", "The signed document, with a certificate recording when it was sent, opened, verified and signed, your IP address, device, place and location, and a SHA-256 fingerprint of the document, is kept as an electronic record that may be produced as evidence under the Bharatiya Sakshya Adhiniyam, 2023."],
    ["Your personal data", "The details recorded with your signature are processed under the Digital Personal Data Protection Act, 2023 only to evidence your signature and to set up your employment, are kept for as long as the law requires, and are not shared except as required by law. You may exercise your rights as a data principal by writing to HR."],
    ["Paper copy and withdrawal", offer ? `You may ask ${company} for a paper copy of the offer and sign it by hand instead, at no cost, by replying to the offer email. You may withdraw your agreement to sign electronically at any time before you sign, by declining here or by contacting HR. Withdrawal does not affect anything signed before it.` : `You may ask HR for a paper copy and sign it by hand instead, at no cost. You may withdraw your agreement to sign electronically at any time before you sign, by contacting HR. Withdrawal does not affect anything signed before it.`],
    ["What you need", offer ? "A current version of Chrome, Edge, Safari or Firefox; access to the email address to which this offer was sent; and location services turned on for your browser. A copy of the signed document will be emailed to you." : "A current version of Chrome, Edge, Safari or Firefox, with location services turned on for your browser. A copy of the signed document will be emailed to you and kept under My documents."],
  ];
  return (
    <ol className="m-0 p-0 list-none flex flex-col gap-3 text-[13.5px] leading-[1.6] text-[#334155]">
      {items.map(([t, d], i) => <li key={t} className="flex gap-3"><span className="flex-none w-6 h-6 rounded-full bg-[#E6F2F1] text-[#0B5E5B] text-[12px] font-bold grid place-items-center mt-0.5">{i + 1}</span><div><div className="font-semibold text-[#0f172a]">{t}</div><div>{d}</div></div></li>)}
    </ol>
  );
}

