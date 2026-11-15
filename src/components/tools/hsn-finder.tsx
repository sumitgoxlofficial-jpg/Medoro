"use client";
import { useMemo, useState } from "react";
import { Check, Copy, Search } from "lucide-react";
import { HSN_CATEGORIES, HSN_CODES, type HsnCategory } from "@/data/hsn-codes";
import { card, input } from "./ui";

const RATES = [0, 5, 18] as const;
const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

/**
 * Searchable HSN / GST list. The whole list is rendered on the server (nothing filtered until someone types), so the
 * codes are in the page's HTML for search engines.
 */
export function HsnFinder() {
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<HsnCategory | "all">("all");
  const [rate, setRate] = useState<number | "all">("all");
  const [copied, setCopied] = useState("");

  const rows = useMemo(() => {
    const words = norm(q).split(" ").filter(Boolean);
    return HSN_CODES.filter((h) => {
      if (cat !== "all" && h.category !== cat) return false;
      if (rate !== "all" && h.gst !== rate) return false;
      if (!words.length) return true;
      const hay = norm(`${h.item} ${h.examples} ${h.hsn} ${h.hsn.replace(/\s/g, "")} ${h.hsn8 ?? ""} ${(h.hsn8 ?? "").replace(/\s/g, "")} ${h.category}`);
      return words.every((w) => hay.includes(w));
    });
  }, [q, cat, rate]);

  async function copy(code: string) {
    try {
      await navigator.clipboard.writeText(code.replace(/\s/g, ""));
      setCopied(code);
      setTimeout(() => setCopied((c) => (c === code ? "" : c)), 1500);
    } catch {
      setCopied("");
    }
  }

  const chip = (on: boolean) => `h-10 px-3.5 rounded-full border text-[14px] font-semibold whitespace-nowrap transition-colors ${on ? "border-[var(--s-brand)] bg-[var(--s-brand)] text-white" : "border-[#C9D1CF] bg-white text-[var(--s-ink-2)] hover:border-[var(--s-ink)]"}`;

  return (
    <div className="flex flex-col gap-4">
      <div className={`${card} flex flex-col gap-4`}>
        <div className="relative">
          <Search size={18} aria-hidden className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--s-muted)]" />
          <label htmlFor="hsn-q" className="sr-only">Search by product, salt or HSN code</label>
          <input id="hsn-q" type="search" className={`${input} pl-10`} placeholder="Search: syringe, ayurvedic, 3004, thermometer…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div role="group" aria-label="Category" className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
          <button type="button" aria-pressed={cat === "all"} className={chip(cat === "all")} onClick={() => setCat("all")}>All categories</button>
          {HSN_CATEGORIES.map((c) => <button key={c} type="button" aria-pressed={cat === c} className={chip(cat === c)} onClick={() => setCat(c)}>{c}</button>)}
        </div>
        <div role="group" aria-label="GST rate" className="flex gap-2 flex-wrap items-center">
          <span className="text-[14px] font-semibold text-[var(--s-ink)] mr-1">GST rate</span>
          <button type="button" aria-pressed={rate === "all"} className={chip(rate === "all")} onClick={() => setRate("all")}>Any</button>
          {RATES.map((r) => <button key={r} type="button" aria-pressed={rate === r} className={chip(rate === r)} onClick={() => setRate(r)}>{r === 0 ? "Nil (0%)" : `${r}%`}</button>)}
        </div>
      </div>

      <p className="m-0 text-[14px] text-[var(--s-muted)]" aria-live="polite">{rows.length} of {HSN_CODES.length} items</p>

      {rows.length ? (
        <div className="rounded-xl border border-[var(--s-line)] overflow-hidden bg-white">
          <table className="w-full border-collapse text-left max-[759px]:block">
            <thead className="bg-[var(--s-soft)] max-[759px]:hidden">
              <tr>
                {["Product", "Category", "HSN", "8-digit", "GST"].map((h) => <th key={h} scope="col" className={`px-4 py-3 text-[12.5px] font-semibold uppercase tracking-[.06em] text-[var(--s-muted)] ${h === "GST" ? "text-right" : ""}`}>{h}</th>)}
              </tr>
            </thead>
            <tbody className="max-[759px]:block">
              {rows.map((h) => (
                <tr key={h.id} className="border-t border-[var(--s-line)] max-[759px]:grid max-[759px]:grid-cols-[1fr_auto] max-[759px]:gap-x-3 max-[759px]:gap-y-1.5 max-[759px]:p-4 max-[759px]:first:border-t-0">
                  <th scope="row" className="px-4 py-3.5 align-top font-normal max-[759px]:p-0 max-[759px]:col-span-1">
                    <span className="block text-[15.5px] font-semibold text-[var(--s-ink)]">{h.item}</span>
                    <span className="block text-[13.5px] text-[var(--s-muted)] mt-0.5">{h.examples}</span>
                    {h.note ? <span className="block text-[13px] text-[#8A5A00] mt-1">{h.note}</span> : null}
                  </th>
                  <td className="px-4 py-3.5 align-top text-[14px] text-[var(--s-ink-2)] whitespace-nowrap max-[759px]:hidden">{h.category}</td>
                  <td className="px-4 py-3.5 align-top max-[759px]:p-0 max-[759px]:col-start-1 max-[759px]:row-start-2">
                    <button type="button" onClick={() => copy(h.hsn)} title="Copy HSN code" className="inline-flex items-center gap-1.5 h-9 px-2.5 -ml-2.5 rounded-md font-mono text-[15px] font-medium text-[var(--s-ink)] hover:bg-[var(--s-soft)]">
                      <span className="min-[760px]:hidden text-[12px] font-sans font-semibold text-[var(--s-muted)]">HSN</span>{h.hsn}
                      {copied === h.hsn ? <Check size={14} aria-hidden className="text-[#146C43]" /> : <Copy size={14} aria-hidden className="text-[var(--s-muted)]" />}
                      <span className="sr-only">{copied === h.hsn ? "Copied" : "Copy"}</span>
                    </button>
                  </td>
                  <td className="px-4 py-3.5 align-top font-mono text-[14.5px] text-[var(--s-ink-2)] whitespace-nowrap max-[759px]:p-0 max-[759px]:col-start-1 max-[759px]:row-start-3 max-[759px]:text-[13.5px]">
                    {h.hsn8 ? <><span className="min-[760px]:hidden font-sans text-[12px] font-semibold text-[var(--s-muted)] mr-1.5">8-digit</span>{h.hsn8}</> : <span className="text-[var(--s-muted)] max-[759px]:hidden">—</span>}
                  </td>
                  <td className="px-4 py-3.5 align-top text-right max-[759px]:p-0 max-[759px]:col-start-2 max-[759px]:row-start-1">
                    <span className={`inline-block rounded-full px-2.5 py-1 text-[14px] font-semibold tabular-nums ${h.gst === 0 ? "bg-[#E6F4EA] text-[#146C43]" : h.gst === 5 ? "bg-[var(--s-brand-tint)] text-[var(--s-brand-ink)]" : "bg-[#FFF4D6] text-[#8A5A00]"}`}>{h.gst === 0 ? "Nil" : `${h.gst}%`}</span>
                    {h.was !== undefined ? <span className="block text-[12.5px] text-[var(--s-muted)] mt-1 whitespace-nowrap">was {h.was}%</span> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className={`${card} text-[15px] text-[var(--s-ink-2)]`}>Nothing matches. Try a shorter word, a different category, or the 4-digit heading (for example 3004).</div>
      )}
      <p className="m-0 text-[13px] text-[var(--s-muted)]">Rates as changed from 22 September 2025; &ldquo;was&rdquo; shows the earlier rate. A product&rsquo;s rate depends on its exact entry in the GST notification, so confirm unusual items with your CA.</p>
    </div>
  );
}
