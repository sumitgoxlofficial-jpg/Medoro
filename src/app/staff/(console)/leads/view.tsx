"use client";
import { useMemo, useState } from "react";
import { BellRing, Calendar, ChevronLeft, ChevronRight, MessageCircle, Percent, Phone, PhoneCall, Plus, Search, Share2, X } from "lucide-react";
import { useToast } from "@/components/ui/toast";
import { LEAD_SOURCES, LOST_REASONS, PRODUCTS, STAGES, product, rupees } from "@/staff/constants";
import { createLead, decideDiscount, logLeadCall, loseLead, moveLead, requestDiscount } from "../../actions";
import { btn, btnPrimary, fieldCls, fmtDay, lbl, panel, useRun } from "../ui";

type Lead = { id: string; code: string; name: string; owner: string; phone: string; city: string; source: string; product: string; stage: string; nextOn: string | null; lostReason: string | null; discountPct: number | null; discountStatus: string | null; last: string | null; staff: string; valuePaise: number };

export function LeadsView({ admin, referral, leads, today, target, monthRevenue }: { admin: boolean; referral: string | null; leads: Lead[]; today: string; target: number; monthRevenue: number }) {
  const toast = useToast();
  const { run, busy } = useRun();
  const [q, setQ] = useState("");
  const [form, setForm] = useState<null | { name: string; owner: string; phone: string; city: string; source: string; product: string }>(null);
  const [losing, setLosing] = useState<string | null>(null);
  const shown = useMemo(() => leads.filter((l) => !q || [l.name, l.owner, l.city, l.phone].join(" ").toLowerCase().includes(q.toLowerCase())), [leads, q]);
  const due = leads.filter((l) => l.nextOn && l.nextOn <= addDays(today, 2) && !["won", "lost"].includes(l.stage)).sort((a, b) => (a.nextOn! < b.nextOn! ? -1 : 1));
  const set = (k: string, v: string) => setForm((f) => (f ? { ...f, [k]: v } : f));

  return (
    <>
      <div className="grid gap-4 grid-cols-1 min-[1100px]:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <div className={panel + " px-[18px] py-4 flex flex-col gap-2.5"}>
          <div className="flex justify-between gap-x-3 gap-y-1 items-start flex-wrap"><strong className="text-[14.5px] whitespace-nowrap">{admin ? "Team" : "My"} sales this month</strong><span className="text-[13px] text-muted text-right flex-[1_1_200px]">{rupees(monthRevenue)}{target ? ` of ${rupees(target)}` : ""} (ex-GST)</span></div>
          {target ? <div className="h-2.5 rounded-[5px] bg-[#EEF0F2] overflow-hidden"><div className="h-full rounded-[5px] bg-[linear-gradient(90deg,#0B5E5B,#0A9A80)]" style={{ width: Math.min(100, Math.round((monthRevenue / target) * 100)) + "%" }} /></div> : null}
          <div className="flex gap-4 flex-wrap text-[13px] text-ink-2">{STAGES.map((s) => <span key={s.id} className="whitespace-nowrap"><strong className="font-bold text-ink">{leads.filter((l) => l.stage === s.id).length}</strong> {s.label.toLowerCase()}</span>)}</div>
        </div>
        <div className={panel + " px-[18px] py-4 flex flex-col gap-2"}>
          <strong className="text-[14.5px] flex gap-1.5 items-center"><BellRing size={16} className="text-[#94570A]" />Follow-ups due</strong>
          {due.length ? due.slice(0, 6).map((l) => (
            <div key={l.id} className="flex gap-2 items-center text-[13px]">
              <span className="font-semibold min-w-[74px]" style={{ color: l.nextOn! < today ? "#C0362C" : l.nextOn === today ? "#94570A" : "#3D454D" }}>{l.nextOn! < today ? "Overdue" : l.nextOn === today ? "Today" : fmtDay(l.nextOn!)}</span>
              <span className="flex-1 min-w-0 truncate">{l.name} · {STAGES.find((s) => s.id === l.stage)?.label}</span>
              <a href={`tel:+91${l.phone}`} aria-label={`Call ${l.name}`} className="flex text-teal"><Phone size={15} /></a>
            </div>
          )) : <span className="text-[13px] text-muted">No follow-ups due. Nice work.</span>}
        </div>
      </div>

      <div className="flex gap-2.5 flex-wrap items-center">
        <div className="flex items-center gap-2 bg-white border border-input rounded-lg px-2.5 h-[38px] flex-1 min-w-[200px] max-w-[360px]"><Search size={16} className="text-fainter" /><input aria-label="Search leads" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search leads" className="border-0 outline-none text-[14px] flex-1 min-w-0" /></div>
        {referral ? <button className={btn + " py-[9px] px-3"} onClick={() => { navigator.clipboard?.writeText(referral); toast(`Referral code ${referral} copied. Sales logged with your name are credited to you.`, "green"); }}><Share2 size={14} />Copy referral code</button> : null}
        <button className={btnPrimary + " ml-auto"} onClick={() => setForm({ name: "", owner: "", phone: "", city: "", source: "Field visit", product: "pro" })}><Plus size={16} />New lead</button>
      </div>

      {form ? (
        <form onSubmit={(e) => { e.preventDefault(); run(() => createLead(form as never), () => { setForm(null); }); }} className={panel + " border-teal-line p-[18px] flex flex-col gap-3"}>
          <strong className="text-[15px]">New lead</strong>
          <div className="grid gap-3 grid-cols-[repeat(auto-fit,minmax(180px,1fr))]">
            {([["name", "Pharmacy name", "Shivam Medicals"], ["owner", "Owner name", ""], ["phone", "Mobile", "98230 55120"], ["city", "City", "Pune"]] as const).map(([k, l, ph]) => (
              <label key={k} className={lbl}>{l}<input className={fieldCls} value={form[k]} onChange={(e) => set(k, e.target.value)} placeholder={ph} inputMode={k === "phone" ? "tel" : undefined} /></label>
            ))}
            <label className={lbl}>Source<select className={fieldCls} value={form.source} onChange={(e) => set("source", e.target.value)}>{LEAD_SOURCES.map((s) => <option key={s}>{s}</option>)}</select></label>
            <label className={lbl}>Interested in<select className={fieldCls} value={form.product} onChange={(e) => set("product", e.target.value)}>{PRODUCTS.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
          </div>
          <div className="flex gap-2 justify-end"><button type="button" className={btn + " px-3.5 py-[9px] text-[14px]"} onClick={() => setForm(null)}>Cancel</button><button disabled={busy} className={btnPrimary}>Save lead</button></div>
        </form>
      ) : null}

      <div className="overflow-x-auto pb-1">
        <div className="grid grid-cols-[repeat(6,minmax(230px,1fr))] gap-3 min-w-[1400px]">
          {STAGES.map((st, si) => {
            const cards = shown.filter((l) => l.stage === st.id);
            return (
              <div key={st.id} className="bg-[#EEF0F2] rounded-xl p-2.5 flex flex-col gap-2 min-h-40">
                <div className="flex justify-between items-center px-1 py-0.5"><span className="text-[12.5px] font-bold tracking-[.04em] uppercase" style={{ color: st.fg }}>{st.label}</span><span className="text-[12px] text-muted">{cards.length} · {rupees(cards.reduce((a, l) => a + l.valuePaise, 0))}/mo</span></div>
                {cards.map((l) => {
                  const overdue = l.nextOn && l.nextOn <= today;
                  return (
                    <div key={l.id} className="bg-white border border-[#E6E8EB] rounded-[10px] px-3 py-2.5 flex flex-col gap-1.5">
                      <div className="flex gap-1.5 items-start"><strong className="text-[13.5px] flex-1">{l.name}</strong><span className="text-[11.5px] font-semibold text-teal whitespace-nowrap">{rupees(l.valuePaise)}/mo</span></div>
                      <span className="text-[12px] text-muted">{l.owner} · {l.city} · {l.source}{admin ? ` · ${l.staff}` : ""}</span>
                      <span className="text-[12px] text-ink-2">{product(l.product).name}</span>
                      <span className="text-[12px] flex gap-1 items-center" style={{ color: overdue ? "#C0362C" : "#5B636B" }}><Calendar size={12} />{l.nextOn ? `Follow up ${l.nextOn < today ? "overdue · " : ""}${fmtDay(l.nextOn)}` : l.stage === "won" ? "Customer" : "Closed"}</span>
                      {l.discountStatus ? <span className="text-[11.5px] font-semibold" style={{ color: l.discountStatus === "approved" ? "#18794E" : l.discountStatus === "rejected" ? "#C0362C" : "#94570A" }}>{l.discountPct}% discount {l.discountStatus}</span> : null}
                      {l.stage === "lost" ? <span className="text-[11.5px] text-[#C0362C]">Lost: {l.lostReason}</span> : null}
                      {losing === l.id ? (
                        <div className="flex gap-1 flex-wrap">{LOST_REASONS.map((r) => <button key={r} disabled={busy} className={btn + " px-2 py-1 text-[12px]"} onClick={() => { setLosing(null); run(() => loseLead(l.id, r)); }}>{r}</button>)}<button className={btn + " px-2 py-1"} onClick={() => setLosing(null)}><X size={13} /></button></div>
                      ) : (
                        <div className="flex gap-1 flex-wrap mt-0.5">
                          {si > 0 && si < 4 ? <button disabled={busy} title="Previous stage" aria-label="Previous stage" className={btn + " px-[7px] py-[5px]"} onClick={() => run(() => moveLead(l.id, "back"))}><ChevronLeft size={14} /></button> : null}
                          {si < 4 ? <button disabled={busy} className={btn + " px-2 py-[5px] text-teal border-teal-border"} onClick={() => run(() => moveLead(l.id, "forward"), (d) => (d.won ? `${l.name} won. A sale was logged for payment verification.` : undefined))}>{si === 3 ? "Mark won" : STAGES[si + 1].label}<ChevronRight size={14} /></button> : null}
                          <a href={`https://wa.me/91${l.phone}`} target="_blank" rel="noreferrer" title="WhatsApp" aria-label="WhatsApp" className={btn + " px-[7px] py-[5px]"}><MessageCircle size={14} className="text-[#18794E]" /></a>
                          {si < 4 ? <button disabled={busy} title="Log call or visit" aria-label="Log call or visit" className={btn + " px-[7px] py-[5px]"} onClick={() => { const n = prompt("What happened on the call or visit?", ""); if (n !== null) run(() => logLeadCall(l.id, n)); }}><PhoneCall size={14} /></button> : null}
                          {!admin && (si === 2 || si === 3) && !l.discountStatus ? <button disabled={busy} title="Request discount" aria-label="Request discount" className={btn + " px-[7px] py-[5px]"} onClick={() => { const p = Number(prompt("Discount percent to request (1–30)", "10")); if (p) run(() => requestDiscount(l.id, p)); }}><Percent size={14} /></button> : null}
                          {admin && l.discountStatus === "pending" ? <><button disabled={busy} className={btn + " text-[#18794E] px-2 py-[5px]"} onClick={() => run(() => decideDiscount(l.id, true))}>Approve</button><button disabled={busy} className={btn + " text-[#C0362C] px-2 py-[5px]"} onClick={() => run(() => decideDiscount(l.id, false))}>Reject</button></> : null}
                          {si < 4 ? <button title="Mark lost" aria-label="Mark lost" className={btn + " px-[7px] py-[5px] text-[#C0362C]"} onClick={() => setLosing(l.id)}><X size={14} /></button> : null}
                        </div>
                      )}
                      {l.last ? <span className="text-[11.5px] text-muted border-t border-[#F1F3F4] pt-[5px]">{l.last}</span> : null}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}

function addDays(iso: string, n: number) { const d = new Date(iso + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
