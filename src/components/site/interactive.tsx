"use client";
import Link from "next/link";
import { useState } from "react";
import { Check, ChevronDown, ChevronUp, Minus, Plus, Sparkles } from "lucide-react";

const inr = (n: number) => "₹" + n.toLocaleString("en-IN");

const PLANS = [
  { name: "Starter", for: "For a single medical store.", m: 999, cap: "1 branch · 2 counters · 3 users", feats: ["GST billing with FEFO batches", "Medicine catalogue and barcode scan", "Expiry and low-stock alerts", "Purchases, suppliers and dues", "WhatsApp PDF invoices", "Daily encrypted Google Drive backup"] },
  { name: "Professional", for: "For busy pharmacies with staff.", m: 2499, rec: true, cap: "1 branch · 5 counters · 10 users", feats: ["Everything in Starter, plus", "Accounts: day book, P&L, GST summary", "Customer credit and statements", "Supplier invoice scanner (review first)", "Roles, permissions and audit trail", "Keeps billing on your shop network if the internet drops"] },
  { name: "Multi-branch", for: "For pharmacy chains.", m: 4499, cap: "Up to 5 branches · 15 counters · 25 users", feats: ["Everything in Professional, plus", "Branch stock and approved transfers", "Central purchasing", "Consolidated and branch reports", "Anomaly review for owners", "Priority support, 9 am to 9 pm"] },
];
const ADDONS: [string, string][] = [["Assisted setup and training", "₹1,999 once"], ["Stock and data migration", "from ₹2,999"], ["Extra branch (Multi-branch)", "₹799 / month"], ["Thermal printer and scanner setup", "Included"]];
const CMP: string[][] = [["Branches", "1", "1", "Up to 5"], ["Counters / devices", "2", "5", "15"], ["Users", "3", "10", "25"], ["GST billing, FEFO, expiry alerts", "✓", "✓", "✓"], ["WhatsApp PDF invoices", "✓", "✓", "✓"], ["Encrypted Drive backups", "✓", "✓", "✓"], ["Accounts, P&L, GST summary", "—", "✓", "✓"], ["Customer credit", "—", "✓", "✓"], ["Invoice scanner", "—", "✓", "✓"], ["Shop-network billing without internet", "—", "✓", "✓"], ["Branch transfers, consolidated reports", "—", "—", "✓"], ["Priority support", "—", "—", "✓"]];
const col = (v: string) => (v === "—" ? "#A3AAB1" : v === "✓" ? "#18794E" : "#1F2328");

export function Pricing() {
  const [yearly, setYearly] = useState(false);
  const [compare, setCompare] = useState(false);
  const seg = (on: boolean) => `border-0 h-[34px] rounded-[7px] text-[14px] font-semibold cursor-pointer text-ink-strong flex gap-1.5 items-center ${on ? "bg-white shadow-[0_1px_2px_rgba(16,24,40,.1)]" : "bg-transparent"}`;
  return (
    <>
      <div className="inline-flex items-center gap-0.5 bg-[#F2F4F5] p-[3px] rounded-[9px] mt-1.5 self-center">
        <button onClick={() => setYearly(false)} aria-pressed={!yearly} className={seg(!yearly) + " px-4"}>Monthly</button>
        <button onClick={() => setYearly(true)} aria-pressed={yearly} className={seg(yearly) + " px-3.5"}>Yearly<span className="text-[11.5px] text-[#18794E] bg-[#E7F6EE] px-1.5 py-px rounded-full">2 months free</span></button>
      </div>
      <div className="grid gap-4 items-stretch grid-cols-[repeat(auto-fit,minmax(min(100%,300px),1fr))]">
        {PLANS.map((p) => (
          <div key={p.name} data-reveal className={`relative bg-white rounded-[18px] p-7 flex flex-col gap-4 ${p.rec ? "border-[1.5px] border-teal shadow-[0_20px_40px_-20px_rgba(11,94,91,.35)]" : "border border-[#E6E8EB] shadow-[0_1px_2px_rgba(16,24,40,.04)]"}`}>
            {p.rec ? <span className="absolute -top-3 left-7 bg-teal text-white text-[12px] font-semibold px-2.5 py-[3px] rounded-full">Recommended</span> : null}
            <div className="flex flex-col gap-1"><h3 className="m-0 font-bold text-[20px] tracking-[-.01em]">{p.name}</h3><span className="text-[14px] text-[#4B535B]">{p.for}</span></div>
            <div className="flex flex-col gap-0.5">
              <div className="flex items-baseline gap-1"><span className="text-[40px] font-bold tracking-[-.03em] tnum">{inr(yearly ? Math.round((p.m * 10) / 12) : p.m)}</span><span className="text-[14px] text-faint">/ month</span></div>
              <span className="text-[13px] text-faint">{yearly ? `Billed ${inr(p.m * 10)} yearly · 2 months free` : "Billed monthly after the 14-day trial"}</span>
            </div>
            <Link href="/start" className={`flex items-center justify-center h-11 rounded-[9px] text-[14.5px] font-semibold hover:opacity-90 ${p.rec ? "bg-teal text-white hover:text-white" : "bg-white text-ink-strong border border-[#E6E8EB] hover:text-ink-strong"}`}>Start free trial</Link>
            <span className="text-[13px] font-semibold text-teal">{p.cap}</span>
            <div className="flex flex-col gap-[9px] border-t border-[#EEF0F2] pt-4">
              {p.feats.map((f) => <span key={f} className="flex gap-[9px] items-start text-[14px] text-[#1F2328]"><Check size={15} className="text-[#18794E] mt-[3px] flex-none" />{f}</span>)}
            </div>
          </div>
        ))}
      </div>
      <div className="grid gap-4 grid-cols-[repeat(auto-fit,minmax(min(100%,300px),1fr))]">
        <div className="bg-[#0E1A1F] text-white rounded-2xl p-6 flex flex-col gap-2">
          <span className="flex gap-2 items-center text-[13px] font-semibold text-[#5FD3BC]"><Sparkles size={15} />ADD-ON</span>
          <div className="flex items-baseline justify-between gap-3 flex-wrap"><h3 className="m-0 font-bold text-[19px]">AI Pharmacy Manager</h3><span className="text-[15px] font-semibold">{yearly ? `${inr(Math.round((499 * 10) / 12))} / month, billed yearly` : "₹499 / month"}</span></div>
          <span className="text-[14px] text-[#B8C7CC]">Hinglish assistant, seasonal demand planner, invoice scanner and reorder suggestions. Add to any plan.</span>
        </div>
        <div className="bg-white border border-[#E6E8EB] rounded-2xl p-6 flex flex-col gap-2.5">
          <h3 className="m-0 font-bold text-[17px]">One-time and extras</h3>
          {ADDONS.map(([l, v]) => <div key={l} className="flex justify-between gap-3 text-[14px] border-b border-[#F2F4F5] pb-2"><span className="text-ink-2">{l}</span><strong className="font-semibold whitespace-nowrap">{v}</strong></div>)}
        </div>
      </div>
      <div className="flex flex-col gap-3">
        <button onClick={() => setCompare((x) => !x)} aria-expanded={compare} className="self-center border border-[#E6E8EB] bg-white h-10 px-4 rounded-[9px] text-[14px] font-semibold cursor-pointer flex gap-1.5 items-center text-ink-strong hover:border-input">
          {compare ? "Hide plan comparison" : "Compare all features"}{compare ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
        </button>
        {compare ? (
          <div className="overflow-x-auto border border-[#E6E8EB] rounded-[14px]">
            <table className="w-full min-w-[640px] border-collapse text-[14px]">
              <thead><tr className="bg-[#F7F8F9]">{["Feature", "Starter", "Professional", "Multi-branch"].map((h, i) => <th key={h} className={`text-left px-4 py-3 font-semibold border-b border-[#E6E8EB] ${i === 2 ? "text-teal" : ""}`}>{h}</th>)}</tr></thead>
              <tbody>{CMP.map((r) => <tr key={r[0]}>{r.map((c, i) => <td key={i} className="px-4 py-[11px] border-b border-[#F2F4F5]" style={{ color: i === 0 ? "#3D454D" : col(c) }}>{c}</td>)}</tr>)}</tbody>
            </table>
          </div>
        ) : null}
      </div>
    </>
  );
}

export function Faq({ groups }: { groups: { title: string; items: [string, string][] }[] }) {
  const [open, setOpen] = useState("0-0");
  return (
    <div className="flex flex-col gap-7">
      {groups.map((g, gi) => (
        <div key={g.title} className="flex flex-col">
          <span className="text-[12.5px] font-semibold text-faint tracking-[.06em] uppercase pb-2">{g.title}</span>
          {g.items.map(([q, a], qi) => {
            const k = `${gi}-${qi}`, on = open === k;
            return (
              <div key={k} className="border-t border-[#EEF0F2]">
                <button onClick={() => setOpen(on ? "" : k)} aria-expanded={on} className="w-full flex justify-between items-center gap-4 border-0 bg-transparent py-4 text-[16px] font-semibold text-ink-strong cursor-pointer text-left">
                  {q}{on ? <Minus size={18} className="text-faint flex-none" /> : <Plus size={18} className="text-faint flex-none" />}
                </button>
                {on ? <p className="m-0 mb-4 text-[15px] text-[#4B535B] text-pretty max-w-[640px]">{a}</p> : null}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
