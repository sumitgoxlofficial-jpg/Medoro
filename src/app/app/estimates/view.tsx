"use client";
import { useEffect, useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Plus, Printer, Search, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Empty } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { inr } from "@/lib/money";
import { dayMonth } from "@/lib/dates";
import { useT } from "@/lib/i18n-client";
import type { EstimateRow } from "@/domain/sales/estimate";
import { createEstimateAction, estimateStatusAction, searchEstimateMedsAction } from "./actions";

const th = "text-left text-[12px] font-medium text-muted px-3.5 py-2.5 border-b border-[#E3E6E9] whitespace-nowrap";
const td = "px-3.5 py-2.5 border-b border-row";
const card = "bg-white border border-line rounded-xl shadow-[0_1px_2px_rgba(16,24,40,.04)]";
type Hit = Awaited<ReturnType<typeof searchEstimateMedsAction>>[number];
type Pick = { id: string; name: string; strength: string; mrp: number; qty: number };

export function EstimatesView({ rows, q }: { rows: EstimateRow[]; q: string }) {
  const t = useT(), router = useRouter(), path = usePathname(), toast = useToast();
  const [open, setOpen] = useState(false), [pending, start] = useTransition();
  const [term, setTerm] = useState(q);
  const tone = (s: string) => (s === "open" ? "teal" : s === "billed" ? "green" : s === "expired" ? "amber" : "gray") as "teal";
  const setStatus = (id: string, status: "open" | "billed" | "cancelled") => start(async () => { const r = await estimateStatusAction(id, status); if (!r.ok) toast(r.error, "red"); else router.refresh(); });
  return (
    <div className="flex flex-col gap-3.5 max-w-[1200px]">
      <div className="flex gap-2 flex-wrap items-center">
        <form className="relative" onSubmit={(e) => { e.preventDefault(); router.replace(term ? `${path}?q=${encodeURIComponent(term)}` : path); }}>
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-faint" />
          <Input value={term} onChange={(e) => setTerm(e.target.value)} placeholder={t("Search number, name or phone")} aria-label={t("Search estimates")} className="pl-8 w-64" />
        </form>
        <Button variant="primary" className="ml-auto" onClick={() => setOpen(true)}><Plus size={14} />{t("New estimate")}</Button>
      </div>
      <div className={card + " overflow-x-auto"}>
        {rows.length ? (
          <table className="w-full text-[13.5px]">
            <thead><tr><th className={th}>{t("Estimate")}</th><th className={th}>{t("Customer")}</th><th className={th}>{t("Items")}</th><th className={th + " text-right"}>{t("Total")}</th><th className={th}>{t("Valid until")}</th><th className={th}>{t("Status")}</th><th className={th} /></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className={td}><strong className="font-mono">{r.no}</strong><div className="text-[12px] text-muted">{dayMonth(new Date(r.createdAt))}</div></td>
                  <td className={td}>{r.customerName || t("Walk-in customer")}{r.phone ? <div className="text-[12px] text-muted">{r.phone}</div> : null}</td>
                  <td className={td}>{r.lines.length}</td>
                  <td className={td + " text-right tnum"}>{inr(r.total)}</td>
                  <td className={td}>{r.validUntil}</td>
                  <td className={td}><Badge tone={tone(r.status)}>{t(r.status === "open" ? "Open" : r.status === "billed" ? "Billed" : r.status === "expired" ? "Expired" : "Cancelled")}</Badge></td>
                  <td className={td}>
                    <div className="flex gap-1.5 justify-end flex-wrap">
                      <a href={`/print/estimate/${r.id}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 border border-input rounded-md px-2.5 py-1.5 text-[12.5px] text-ink no-underline hover:border-teal"><Printer size={13} />{t("Print")}</a>
                      {r.status === "open" || r.status === "expired" ? <><Button disabled={pending} onClick={() => setStatus(r.id, "billed")}>{t("Mark billed")}</Button><Button disabled={pending} className="text-bad" onClick={() => setStatus(r.id, "cancelled")}>{t("Cancel")}</Button></> : <Button disabled={pending} onClick={() => setStatus(r.id, "open")}>{t("Reopen")}</Button>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <Empty title={t("No estimates yet.")} />}
      </div>
      {open ? <NewEstimate onClose={() => setOpen(false)} onDone={(id) => { setOpen(false); router.refresh(); window.open(`/print/estimate/${id}`, "_blank"); }} /> : null}
    </div>
  );
}

function NewEstimate({ onClose, onDone }: { onClose: () => void; onDone: (id: string) => void }) {
  const t = useT(), toast = useToast();
  const [name, setName] = useState(""), [phone, setPhone] = useState(""), [days, setDays] = useState("7"), [notes, setNotes] = useState("");
  const [term, setTerm] = useState(""), [hits, setHits] = useState<Hit[]>([]), [picked, setPicked] = useState<Pick[]>([]), [pending, start] = useTransition();
  useEffect(() => {
    if (term.trim().length < 2) { setHits([]); return; }
    const h = setTimeout(() => { void searchEstimateMedsAction(term).then(setHits); }, 200);
    return () => clearTimeout(h);
  }, [term]);
  const add = (m: Hit) => { setPicked((p) => (p.some((x) => x.id === m.id) ? p.map((x) => (x.id === m.id ? { ...x, qty: x.qty + 1 } : x)) : [...p, { id: m.id, name: m.name, strength: m.strength, mrp: m.mrp, qty: 1 }])); setTerm(""); setHits([]); };
  const total = picked.reduce((a, p) => a + p.mrp * p.qty, 0);
  const save = () => start(async () => {
    const r = await createEstimateAction({ customerName: name, phone, validDays: Number(days) || 7, notes, lines: picked.map((p) => ({ medicineId: p.id, qty: p.qty })) });
    if (!r.ok) return toast(r.error, "red");
    onDone(r.data.id);
  });
  return (
    <Modal open title={t("New estimate")} onClose={onClose}>
      <div className="flex flex-col gap-3">
        <div className="grid grid-cols-2 gap-2">
          <Field label={t("Customer name")}><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <Field label={t("Mobile")}><Input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="numeric" /></Field>
        </div>
        <Field label={t("Add medicine")}>
          <div className="relative">
            <Input value={term} onChange={(e) => setTerm(e.target.value)} placeholder={t("Search brand, salt or barcode")} />
            {hits.length ? <div className="absolute z-10 left-0 right-0 mt-1 bg-white border border-line rounded-lg shadow-lg max-h-56 overflow-auto">
              {hits.map((m) => <button key={m.id} type="button" onClick={() => add(m)} className="w-full text-left px-3 py-2 text-[13px] hover:bg-chip flex justify-between gap-2 cursor-pointer border-0 bg-transparent"><span>{m.name} <span className="text-muted">{m.strength}</span></span><span className="tnum text-muted">{inr(m.mrp)}</span></button>)}
            </div> : null}
          </div>
        </Field>
        {picked.length ? <div className="border border-line rounded-lg">
          {picked.map((p) => (
            <div key={p.id} className="flex items-center gap-2 px-3 py-2 border-b border-row last:border-0 text-[13px]">
              <span className="flex-1 min-w-0 truncate">{p.name} <span className="text-muted">{p.strength}</span></span>
              <span className="tnum text-muted">{inr(p.mrp)}</span>
              <input aria-label={t("Quantity")} value={p.qty} inputMode="numeric" onChange={(e) => setPicked(picked.map((x) => (x.id === p.id ? { ...x, qty: Math.max(1, Number(e.target.value.replace(/\D/g, "")) || 1) } : x)))} className="w-14 border border-input rounded-md px-2 py-1 text-right" />
              <button type="button" aria-label={t("Remove")} onClick={() => setPicked(picked.filter((x) => x.id !== p.id))} className="text-bad cursor-pointer border-0 bg-transparent"><Trash2 size={14} /></button>
            </div>
          ))}
          <div className="flex justify-between px-3 py-2 font-semibold text-[13.5px]"><span>{t("Total")}</span><span className="tnum">{inr(total)}</span></div>
        </div> : null}
        <div className="grid grid-cols-[120px_1fr] gap-2">
          <Field label={t("Valid for (days)")}><Input value={days} onChange={(e) => setDays(e.target.value.replace(/\D/g, ""))} inputMode="numeric" /></Field>
          <Field label={t("Notes")}><Input value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
        </div>
        <div className="text-[12px] text-faint">{t("Prices are today’s MRP. Stock and price are checked again when the bill is made.")}</div>
        <Button variant="primary" disabled={pending || !picked.length} onClick={save}>{t("Create and print")}</Button>
      </div>
    </Modal>
  );
}
