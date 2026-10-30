"use client";
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Download, FileJson, Receipt, Truck, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Empty } from "@/components/ui/card";
import { Checkbox, Field, Input, Select } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { inr, inr0 } from "@/lib/money";
import { dayMonth } from "@/lib/dates";
import { CANCEL_REASONS, TRANSPORT_MODES } from "@/domain/gst/contracts";
import { TALLY_GROUPS } from "@/domain/gst/tally";
import type { gstRollup, einvoiceQueue, einvoiceState, registrations, tallyMapping } from "@/domain/gst/service";
import type { gstr1Summary } from "@/domain/gst/gstr1";
import { cancelIrnAction, gstSettingsAction, irnAction, saleEwbAction, transferEwbAction } from "./gst-actions";

const card = "bg-white border border-line rounded-xl shadow-[0_1px_2px_rgba(16,24,40,.04)]";
const th = "text-left text-[12px] font-medium text-muted px-3 py-2 border-b border-[#E3E6E9] whitespace-nowrap";
const td = "px-3 py-2 border-b border-row align-top";
const num = " text-right tnum";
const rupees = (x: number) => x.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

type Props = {
  regs: Awaited<ReturnType<typeof registrations>>; gstin: string; month: string;
  g1: ReturnType<typeof gstr1Summary> | null; warnings: string[]; g3: (string | number)[][] | null;
  rollup: Awaited<ReturnType<typeof gstRollup>>; queue: Awaited<ReturnType<typeof einvoiceQueue>>; einv: Awaited<ReturnType<typeof einvoiceState>>;
  tally: Awaited<ReturnType<typeof tallyMapping>>; canIntegrations: boolean; canRefund: boolean; today: string;
};

export function GstView(p: Props) {
  const router = useRouter();
  const q = (extra: Record<string, string>) => `/api/gst/${extra.kind}?${new URLSearchParams({ gstin: p.gstin, month: p.month, ...extra }).toString()}`;
  const go = (gstin: string, month: string) => router.push(`/app/accounts?view=gst&gstin=${encodeURIComponent(gstin)}&month=${month}`);
  return (
    <div className="flex flex-col gap-4 max-w-[1400px]">
      <div className={card + " flex gap-3 items-end flex-wrap px-4 py-3"}>
        <Field label="Return period"><Input type="month" value={p.month} max={p.today.slice(0, 7)} onChange={(e) => e.target.value && go(p.gstin, e.target.value)} /></Field>
        <Field label="GSTIN">
          <Select value={p.gstin} onChange={(e) => go(e.target.value, p.month)} disabled={!p.regs.list.length}>
            {p.regs.list.map((r) => <option key={r.gstin} value={r.gstin}>{r.gstin} · {r.state} · {r.branches.map((b) => b.name).join(", ")}</option>)}
          </Select>
        </Field>
        <div className="text-[12.5px] text-muted ml-auto max-w-[420px]">Generated from posted sales, credit notes and purchase ledgers. Have your CA review before filing; Medoro does not file returns.</div>
      </div>
      {p.regs.unregistered.length ? <div className="text-[13px] text-warn bg-warn-bg rounded-lg px-3 py-2">No GSTIN on {p.regs.unregistered.join(", ")}: add one under Users &amp; branches to include those sales.</div> : null}
      {p.warnings.map((w) => <div key={w} className="text-[13px] text-warn bg-warn-bg rounded-lg px-3 py-2">{w}</div>)}

      {!p.regs.list.length ? <div className={card}><Empty icon={Receipt} title="No GSTIN set up" body="Add the pharmacy’s or each branch’s GSTIN under Users & branches to build GST returns." /></div> : (
        <div className="grid gap-4 grid-cols-[repeat(auto-fit,minmax(min(100%,560px),1fr))]">
          <div className={card + " px-4 py-3.5 flex flex-col gap-2.5"}>
            <div className="flex items-baseline justify-between gap-2 flex-wrap"><div className="font-semibold text-[15px]">GSTR-1 · outward supplies</div>
              <div className="flex gap-1.5 flex-wrap">
                <a href={q({ kind: "gstr1-json" })}><Button size="sm" variant="primary"><FileJson size={14} />JSON for offline tool</Button></a>
                <a href={q({ kind: "gstr1-csv" })}><Button size="sm"><Download size={14} />CSV summary</Button></a>
                <a href={q({ kind: "hsn-csv" })}><Button size="sm"><Download size={14} />HSN CSV</Button></a>
              </div></div>
            <table className="w-full border-collapse text-[13px]">
              <thead><tr><th className={th}>Section</th><th className={th + num}>Docs / rows</th><th className={th + num}>Taxable ₹</th><th className={th + num}>IGST</th><th className={th + num}>CGST</th><th className={th + num}>SGST</th></tr></thead>
              <tbody>
                {p.g1?.sections.map((s) => <tr key={s.section}><td className={td}>{s.section}</td><td className={td + num}>{s.count}</td><td className={td + num}>{rupees(s.taxable)}</td><td className={td + num}>{rupees(s.igst)}</td><td className={td + num}>{rupees(s.cgst)}</td><td className={td + num}>{rupees(s.sgst)}</td></tr>)}
                {!p.g1?.sections.length ? <tr><td className={td + " text-fainter"} colSpan={6}>No invoices or credit notes in this period.</td></tr> : null}
                <tr><td className={td}>HSN summary (12)</td><td className={td + num}>{p.g1?.hsnRows ?? 0}</td><td className={td} colSpan={4} /></tr>
                {p.g1?.docs.map((d) => <tr key={d.kind + d.from}><td className={td}>Documents issued (13) · {d.kind}</td><td className={td + " text-muted"} colSpan={5}>{d.from} – {d.to} · total {d.totnum} · cancelled {d.cancel} · net {d.net_issue}</td></tr>)}
              </tbody>
            </table>
          </div>

          <div className={card + " px-4 py-3.5 flex flex-col gap-2.5"}>
            <div className="flex items-baseline justify-between gap-2 flex-wrap"><div className="font-semibold text-[15px]">GSTR-3B · summary</div>
              <div className="flex gap-1.5">
                <a href={q({ kind: "gstr3b-json" })}><Button size="sm" variant="primary"><FileJson size={14} />JSON</Button></a>
                <a href={q({ kind: "gstr3b-csv" })}><Button size="sm"><Download size={14} />CSV</Button></a>
              </div></div>
            <table className="w-full border-collapse text-[13px]">
              <thead><tr>{(p.g3?.[2] ?? []).map((h, i) => <th key={i} className={th + (i > 1 ? num : "")}>{h}</th>)}</tr></thead>
              <tbody>{(p.g3 ?? []).slice(3).map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} className={td + (j > 1 ? num : j === 1 ? " text-ink-2" : " whitespace-nowrap")}>{c}</td>)}</tr>)}</tbody>
            </table>
          </div>
        </div>
      )}

      <Rollup r={p.rollup} />
      <EinvoicePanel queue={p.queue} einv={p.einv} canRefund={p.canRefund} />
      <TallyPanel tally={p.tally} gstins={p.regs.list.map((r) => r.gstin)} month={p.month} today={p.today} />
      <SettingsPanel einv={p.einv} canIntegrations={p.canIntegrations} />
    </div>
  );
}

function Rollup({ r }: { r: Props["rollup"] }) {
  const cells = (x: Props["rollup"]["total"]) => {
    const out = x.igst + x.cgst + x.sgst, itc = x.itcIgst + x.itcCgst + x.itcSgst;
    return <><td className={td + num}>{x.invoices}/{x.creditNotes}</td><td className={td + num}>{inr0(x.taxable)}</td><td className={td + num}>{inr0(x.igst)}</td><td className={td + num}>{inr0(x.cgst)}</td><td className={td + num}>{inr0(x.sgst)}</td><td className={td + num}>{inr0(itc)}</td><td className={td + num + " font-semibold"}>{inr0(out - itc)}</td></>;
  };
  return (
    <div className={card + " overflow-auto"}>
      <div className="px-4 pt-3.5 pb-1 font-semibold text-[15px]">All branches · GSTIN-wise roll-up <span className="text-[12px] font-normal text-faint">{r.label}</span></div>
      <table className="w-full border-collapse text-[13px] min-w-[860px]">
        <thead><tr><th className={th}>GSTIN / branch</th><th className={th + num}>Invoices/CNs</th><th className={th + num}>Taxable (net)</th><th className={th + num}>Output IGST</th><th className={th + num}>Output CGST</th><th className={th + num}>Output SGST</th><th className={th + num}>ITC (net)</th><th className={th + num}>Net tax</th></tr></thead>
        <tbody>
          {r.groups.map((g) => [
            <tr key={g.gstin} className="bg-subtle font-semibold"><td className={td + " font-mono"}>{g.gstin} <span className="font-sans font-normal text-muted">· {g.state}</span></td>{cells(g.total)}</tr>,
            ...g.branches.map((b) => <tr key={g.gstin + b.id}><td className={td + " pl-7"}>{b.name}</td>{cells(b)}</tr>),
          ])}
          <tr className="font-semibold"><td className={td}>All branches</td>{cells(r.total)}</tr>
        </tbody>
      </table>
      <div className="px-4 py-2 text-[12px] text-faint">Net tax = output tax after credit notes − input tax credit (purchases net of debit notes and reversals). Cash and set-off order is decided when filing.</div>
    </div>
  );
}

type Transport = { distanceKm: string; mode: "1" | "2" | "3" | "4"; vehicleNo: string; transporterId: string; transporterName: string; transDocNo: string; transDocDate: string };
const blankTransport: Transport = { distanceKm: "", mode: "1", vehicleNo: "", transporterId: "", transporterName: "", transDocNo: "", transDocDate: "" };

function EinvoicePanel({ queue, einv, canRefund }: { queue: Props["queue"]; einv: Props["einv"]; canRefund: boolean }) {
  const toast = useToast();
  const [pending, start] = useTransition();
  const [ewb, setEwb] = useState<{ kind: "sale" | "transfer"; id: string; no: string } | null>(null);
  const [cancel, setCancel] = useState<{ id: string; no: string } | null>(null);
  const irn = (id: string) => start(async () => { const r = await irnAction(id); toast(r.ok ? `IRN generated · Ack ${r.data.ackNo}` : r.error, r.ok ? "green" : "red"); });
  const status = !einv.configured ? <Badge tone="gray">Not configured on server</Badge> : !einv.applicable ? <Badge tone="amber">Turned off in settings</Badge> : <Badge tone="green">On · {einv.provider} · {einv.gstin}</Badge>;
  return (
    <div className={card + " overflow-auto"}>
      <div className="px-4 pt-3.5 pb-1 flex items-center gap-2 flex-wrap"><span className="font-semibold text-[15px]">E-invoices (IRN) &amp; e-way bills</span>{status}</div>
      <table className="w-full border-collapse text-[13px] min-w-[900px]">
        <thead><tr><th className={th}>B2B invoice</th><th className={th}>Customer</th><th className={th + num}>Value</th><th className={th}>IRN</th><th className={th}>E-way bill</th><th className={th} /></tr></thead>
        <tbody>
          {queue.sales.map((s) => (
            <tr key={s.id}>
              <td className={td}><div className="font-mono">{s.no}</div><div className="text-[12px] text-muted">{dayMonth(new Date(s.at), true)}</div></td>
              <td className={td}>{s.customer}<div className="text-[12px] text-muted font-mono">{s.gstin}</div></td>
              <td className={td + num}>{inr(s.total)}</td>
              <td className={td}>{s.irn ? <span className="font-mono text-[11.5px] break-all">{s.irn.slice(0, 20)}…</span> : s.cancelled ? <Badge tone="red">Cancelled</Badge> : <span className="text-fainter">—</span>}</td>
              <td className={td}>{s.ewbNo ? <span className="font-mono">{s.ewbNo}</span> : s.ewbRequired ? <Badge tone="amber">Needed above ₹50,000</Badge> : <span className="text-fainter">—</span>}</td>
              <td className={td + " text-right whitespace-nowrap"}>
                <div className="flex gap-1.5 justify-end">
                  <a href={`/print/invoice/${s.id}`} target="_blank" rel="noreferrer"><Button size="sm" variant="ghost">Print</Button></a>
                  {einv.enabled && !s.irn && !s.cancelled ? <Button size="sm" variant="primary" disabled={pending} onClick={() => irn(s.id)}>Generate IRN</Button> : null}
                  {einv.enabled && s.irn && !s.ewbNo ? <Button size="sm" disabled={pending} onClick={() => setEwb({ kind: "sale", id: s.id, no: s.no })}><Truck size={13} />E-way bill</Button> : null}
                  {einv.enabled && canRefund && s.irn && s.canCancel ? <Button size="sm" variant="ghost" disabled={pending} title={s.fullyReturned ? "" : "Return the whole invoice first"} onClick={() => setCancel({ id: s.id, no: s.no })}>Cancel IRN</Button> : null}
                </div>
              </td>
            </tr>
          ))}
          {!queue.sales.length ? <tr><td className={td + " text-fainter"} colSpan={6}>No invoices to GST-registered customers this month. Attach a customer with a GSTIN at billing to make a B2B invoice.</td></tr> : null}
        </tbody>
      </table>
      {queue.transfers.length ? (
        <table className="w-full border-collapse text-[13px] min-w-[900px] mt-2">
          <thead><tr><th className={th}>Branch transfer</th><th className={th}>Goods</th><th className={th}>Route</th><th className={th + num}>Value at cost</th><th className={th}>E-way bill</th><th className={th} /></tr></thead>
          <tbody>{queue.transfers.map((t) => (
            <tr key={t.id}>
              <td className={td + " font-mono"}>{t.no}</td><td className={td}>{t.item}</td><td className={td}>{t.from} → {t.to}</td><td className={td + num}>{inr(t.value)}</td>
              <td className={td}>{t.ewbNo ? <span className="font-mono">{t.ewbNo}</span> : t.ewbRequired ? <Badge tone="amber">Needed above ₹50,000</Badge> : <span className="text-fainter">Not needed</span>}</td>
              <td className={td + " text-right"}>{einv.enabled && !t.ewbNo ? <Button size="sm" disabled={pending} onClick={() => setEwb({ kind: "transfer", id: t.id, no: t.no })}><Truck size={13} />E-way bill</Button> : null}</td>
            </tr>
          ))}</tbody>
        </table>
      ) : null}
      <EwbModal target={ewb} onClose={() => setEwb(null)} />
      <CancelModal target={cancel} onClose={() => setCancel(null)} />
    </div>
  );
}

function EwbModal({ target, onClose }: { target: { kind: "sale" | "transfer"; id: string; no: string } | null; onClose: () => void }) {
  const toast = useToast();
  const [f, setF] = useState(blankTransport), [err, setErr] = useState(""), [pending, start] = useTransition();
  useEffect(() => { setF(blankTransport); setErr(""); }, [target]);
  if (!target) return null;
  const set = (k: keyof Transport) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const submit = () => start(async () => {
    const r = target.kind === "sale" ? await saleEwbAction(target.id, f) : await transferEwbAction(target.id, f);
    if (!r.ok) return setErr(r.error);
    toast(`E-way bill ${r.data} generated.`, "green"); onClose();
  });
  return (
    <Modal open onClose={onClose} title="Generate e-way bill" sub={target.no} width={520}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={submit} disabled={pending}>Generate</Button></>}>
      <div className="grid grid-cols-2 gap-2.5 max-sm:grid-cols-1">
        <Field label="Distance (km)" hint="0 lets the portal calculate it from the PIN codes."><Input value={f.distanceKm} onChange={set("distanceKm")} inputMode="numeric" /></Field>
        <Field label="Mode"><Select value={f.mode} onChange={set("mode")}>{Object.entries(TRANSPORT_MODES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
        <Field label="Vehicle no."><Input value={f.vehicleNo} onChange={set("vehicleNo")} placeholder="MH12AB1234" className="font-mono" /></Field>
        <Field label="Transporter ID (GSTIN/TRANSIN)"><Input value={f.transporterId} onChange={set("transporterId")} className="font-mono" maxLength={15} /></Field>
        <Field label="Transporter name"><Input value={f.transporterName} onChange={set("transporterName")} /></Field>
        <Field label="LR / RR / AWB no."><Input value={f.transDocNo} onChange={set("transDocNo")} /></Field>
        <Field label="Transport document date"><Input type="date" value={f.transDocDate} onChange={set("transDocDate")} /></Field>
      </div>
      {err ? <div role="alert" className="text-[13px] text-bad">{err}</div> : null}
    </Modal>
  );
}

function CancelModal({ target, onClose }: { target: { id: string; no: string } | null; onClose: () => void }) {
  const toast = useToast();
  const [reason, setReason] = useState<keyof typeof CANCEL_REASONS>("2"), [remark, setRemark] = useState(""), [err, setErr] = useState(""), [pending, start] = useTransition();
  useEffect(() => { setReason("2"); setRemark(""); setErr(""); }, [target]);
  if (!target) return null;
  const submit = () => start(async () => {
    const r = await cancelIrnAction(target.id, reason, remark);
    if (!r.ok) return setErr(r.error);
    toast(r.message!, "green"); onClose();
  });
  return (
    <Modal open onClose={onClose} title="Cancel IRN" sub={`${target.no} · allowed within 24 hours, after the invoice is fully returned`} width={460}
      footer={<><Button onClick={onClose}>Keep</Button><Button variant="primary" onClick={submit} disabled={pending}>Cancel IRN</Button></>}>
      <Field label="Reason"><Select value={reason} onChange={(e) => setReason(e.target.value as keyof typeof CANCEL_REASONS)}>{Object.entries(CANCEL_REASONS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
      <Field label="Remark"><Input value={remark} onChange={(e) => setRemark(e.target.value)} maxLength={100} /></Field>
      {err ? <div role="alert" className="text-[13px] text-bad">{err}</div> : null}
    </Modal>
  );
}

function TallyPanel({ tally, gstins, month, today }: { tally: Props["tally"]; gstins: string[]; month: string; today: string }) {
  const toast = useToast();
  const [from, setFrom] = useState(`${month}-01`), [to, setTo] = useState(() => { const last = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).toISOString().slice(0, 10); return last > today ? today : last; });
  const [scope, setScope] = useState("all");
  const [company, setCompany] = useState(tally.company), [rows, setRows] = useState(tally.rows), [pending, start] = useTransition();
  useEffect(() => { setCompany(tally.company); setRows(tally.rows); }, [tally]);
  const save = () => start(async () => {
    const r = await gstSettingsAction({ tallyCompany: company, tallyMap: Object.fromEntries(rows.map((x) => [x.account, { ledger: x.ledger, group: x.group as (typeof TALLY_GROUPS)[number] }])) });
    toast(r.ok ? r.message! : r.error, r.ok ? "green" : "red");
  });
  const href = (kind: string) => `/api/gst/${kind}?${new URLSearchParams({ from, to, scope }).toString()}`;
  return (
    <div className={card + " px-4 py-3.5 flex flex-col gap-3"}>
      <div className="font-semibold text-[15px]">Tally Prime export</div>
      <div className="flex gap-2.5 items-end flex-wrap">
        <Field label="From"><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field label="To"><Input type="date" value={to} max={today} onChange={(e) => setTo(e.target.value)} /></Field>
        <Field label="Books"><Select value={scope} onChange={(e) => setScope(e.target.value)}><option value="all">Whole pharmacy</option>{gstins.map((g) => <option key={g} value={g}>Branches under {g}</option>)}</Select></Field>
        <a href={href("tally-masters")}><Button><Download size={14} />Masters XML (ledgers)</Button></a>
        <a href={href("tally-vouchers")}><Button variant="primary"><Download size={14} />Vouchers XML</Button></a>
      </div>
      <div className="text-[12.5px] text-muted">Import masters first (Gateway of Tally → Import → Masters), then vouchers (Import → Transactions). Party ledgers use the customer or supplier name.</div>
      <details>
        <summary className="cursor-pointer text-[13.5px] font-medium">Ledger mapping ({rows.length} accounts)</summary>
        <div className="flex flex-col gap-2 mt-2">
          <Field label="Tally company name" hint="Must match the company open in Tally."><Input value={company} onChange={(e) => setCompany(e.target.value)} className="max-w-[360px]" /></Field>
          <div className="overflow-auto">
            <table className="w-full border-collapse text-[13px] min-w-[700px]">
              <thead><tr><th className={th}>Medoro account</th><th className={th}>Tally ledger</th><th className={th}>Group</th></tr></thead>
              <tbody>{rows.map((r, i) => (
                <tr key={r.account}>
                  <td className={td}>{r.account}</td>
                  <td className={td}><Input aria-label={`Tally ledger for ${r.account}`} value={r.ledger} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, ledger: e.target.value } : x)))} /></td>
                  <td className={td}><Select aria-label={`Tally group for ${r.account}`} value={r.group} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, group: e.target.value } : x)))}>{TALLY_GROUPS.map((g) => <option key={g}>{g}</option>)}</Select></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
          <Button variant="primary" className="self-start" onClick={save} disabled={pending}><Save size={14} />Save mapping</Button>
        </div>
      </details>
    </div>
  );
}

function SettingsPanel({ einv, canIntegrations }: { einv: Props["einv"]; canIntegrations: boolean }) {
  const toast = useToast();
  const [on, setOn] = useState(einv.applicable), [pending, start] = useTransition();
  useEffect(() => setOn(einv.applicable), [einv.applicable]);
  const toggle = (v: boolean) => start(async () => {
    setOn(v);
    const r = await gstSettingsAction({ einvoicing: v });
    if (!r.ok) { setOn(!v); toast(r.error, "red"); } else toast(r.message!, "green");
  });
  return (
    <div className={card + " px-4 py-3.5 flex flex-col gap-2"}>
      <div className="font-semibold text-[15px]">GST settings</div>
      <Checkbox checked={on} disabled={!canIntegrations || pending} onChange={(e) => toggle(e.target.checked)} label="E-invoicing applicable (aggregate turnover above the notified limit, currently ₹5 crore)" />
      <div className="text-[12.5px] text-muted">{einv.configured ? `IRP connection: ${einv.provider} for GSTIN ${einv.gstin}.` : "The IRP connection is configured on the server with the EINVOICE_* settings (see docs/GST_COMPLIANCE.md)."} Only owners can change this.</div>
    </div>
  );
}
