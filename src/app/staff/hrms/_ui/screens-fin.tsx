"use client";
import { useState } from "react";
import type { Data } from "@/staff/hrms/screens";
import { GST_RATES, inr } from "@/staff/hrms/constants";
import { addRecord, createInvoice, deleteRecord, openInvoice, setRecordStatus, setWorkflow } from "../actions";
import { Card, Field, Grid, Modal, Pill, Stat, Table, Tabs, btnCls, cx, dangerCls, dayLabel, download, inputCls, primaryCls, statusTone, tdCls, useRun } from "./kit";
import Link from "next/link";

const lakh = (n: number) => (Math.abs(n) >= 1e7 ? `₹${(n / 1e7).toFixed(2)} Cr` : Math.abs(n) >= 1e5 ? `₹${(n / 1e5).toFixed(2)} L` : inr(n));

export function FinHome({ d }: { d: Data<"finhome"> }) {
  const s = d.sum, max = Math.max(1, ...s.spend.map((x) => x[1]));
  const mods: [string, string, string][] = [["fin_contacts", "Contacts", "Customers & vendors"], ["fin_sales", "Sales & Invoices", "Invoices, quotes, receipts"], ["fin_purchases", "Purchases & Expenses", "Bills and payables"], ["fin_accounting", "Accounting", "Chart of accounts, journals"], ["fin_products", "Products & Inventory", "Stock and valuation"], ["fin_reports", "Reports", "P&L and ageing"], ["fin_gst", "GST Reports", "Output and input tax"], ["fin_banking", "Banking & Payments", "Accounts and payments"], ["payroll", "Payroll & HRMS", "Run payroll"]];
  return <>
    <Grid n={4}><Stat l="Payroll this month" v={lakh(s.payrollMonth)} sub={`${s.payslipsMonth} payslips`} /><Stat l="Reimbursements" v={lakh(s.claimsMonth)} c="#0f172a" sub="approved this month" /><Stat l="Claims pending" v={s.claimsOpen} c="#B45309" sub="awaiting sign-off" /><Stat l="Receivable" v={lakh(s.receivable)} c="#0f172a" sub={`${lakh(s.overdue)} overdue`} /></Grid>
    <Grid n={2}>
      <Card title="Spend by category" sub="All time, from payroll and bills" pad>{s.spend.map(([k, v]) => <div key={k} className="flex items-center gap-3 py-1.5 text-[13px]"><span className="w-36">{k}</span><div className="flex-1 h-2.5 bg-[#E2E8F0] rounded-full"><div className="h-full bg-[#14B8A6] rounded-full" style={{ width: `${(v * 100) / max}%` }} /></div><strong className="w-24 text-right">{lakh(v)}</strong></div>)}</Card>
      <Card title="Statutory deductions" sub="Withheld in payroll" pad>{([["TDS", s.statutory.tds], ["Provident fund", s.statutory.pf], ["ESI", s.statutory.esi], ["Professional tax", s.statutory.pt]] as const).map(([k, v]) => <div key={k} className="flex justify-between py-1.5 text-[13px] border-t border-[#F1F5F9] first:border-0"><span>{k}</span><strong>{inr(v)}</strong></div>)}</Card>
    </Grid>
    <Card title="All modules" pad><Grid n={4}>{mods.map(([id, t, sub]) => <Link key={id} href={`/staff/hrms/${id}`} className="border border-[#E2E8F0] rounded-xl p-3.5 hover:border-[#14B8A6] block"><div className="font-bold text-[13.5px]">{t}</div><div className="text-[12px] text-[#64748B]">{sub}</div></Link>)}</Grid></Card>
  </>;
}

type Regs = Data<"fin_sales">["regs"];
export function RegisterScreen({ regs }: { regs: Regs }) {
  const [tab, setTab] = useState(regs[0]?.reg.id ?? "");
  const cur = regs.find((r) => r.reg.id === tab) ?? regs[0];
  const { run, busy } = useRun();
  const [form, setForm] = useState<string[] | null>(null), [inv, setInv] = useState(false), [view, setView] = useState<Extract<Awaited<ReturnType<typeof openInvoice>>, { ok: true }>["data"] | null>(null);
  if (!cur) return null;
  const { reg, rows, stats } = cur;
  const isInv = reg.id === "invoices";
  const si = reg.cols.indexOf("Status") >= 0 ? reg.cols.indexOf("Status") : reg.cols.length - 1;
  return <>
    {regs.length > 1 ? <Tabs value={tab} onChange={setTab} options={regs.map((r) => [r.reg.id, r.reg.label] as [string, string])} /> : null}
    <Grid n={4}>{stats.map(([l, v], i) => <Stat key={l} l={l} v={v} c={i % 3 === 2 ? "#B45309" : undefined} />)}</Grid>
    <Card title={reg.list} right={<><button className={btnCls} onClick={() => download(`${reg.id}.csv`, [reg.cols.join(","), ...rows.map((r) => r.v.map((c) => `"${c.replace(/"/g, '""')}"`).join(","))].join("\n"))}>↓ Export</button><button className={primaryCls} onClick={() => (isInv ? setInv(true) : setForm(reg.cols.map(() => "")))}>+ {reg.act}</button></>}>
      <Table head={[...reg.cols, ""]} empty={rows.length ? undefined : `No ${reg.label.toLowerCase()} yet.`}>
        {rows.map((r) => <tr key={r.id}>{reg.cols.map((c, i) => <td key={c} className={tdCls}>{i === si && (reg.status.length || c === "Status") && reg.status.length ? (
          <select aria-label={`${c} of ${r.v[0]}`} className="border border-[#CDD2D7] rounded-lg px-2 py-1 text-[12.5px] bg-white" value={r.v[i]} onChange={(e) => run(() => setRecordStatus(r.id, e.target.value))}>{reg.status.map((s) => <option key={s}>{s}</option>)}</select>
        ) : reg.money === i ? inr(Number(r.v[i]) || 0) : r.v[i] || "—"}</td>)}
          <td className={tdCls}><div className="flex gap-1.5">{r.hasDoc ? <button className={btnCls} onClick={() => run(() => openInvoice(r.id), (x) => { setView(x); })}>View</button> : null}<button className={dangerCls} onClick={() => { if (confirm("Delete this record?")) run(() => deleteRecord(r.id)); }}>Delete</button></div></td></tr>)}
      </Table>
    </Card>
    {form ? <Modal title={reg.act} onClose={() => setForm(null)}>
      <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); run(() => addRecord(reg.id, form), () => { setForm(null); }); }}>
        {reg.cols.map((c, i) => c === "Status" || (reg.status.length && i === reg.cols.length - 1) ? <Field key={c} label={c}><select className={inputCls} value={form[i] || reg.status[0]} onChange={(e) => setForm(form.map((x, j) => (j === i ? e.target.value : x)))}>{reg.status.map((s) => <option key={s}>{s}</option>)}</select></Field>
          : <Field key={c} label={c + (i === 0 && reg.prefix ? " (leave blank to number automatically)" : "")}><input className={inputCls} value={form[i]} inputMode={reg.money === i ? "decimal" : undefined} onChange={(e) => setForm(form.map((x, j) => (j === i ? e.target.value : x)))} /></Field>)}
        <button className={primaryCls} disabled={busy}>Save</button></form></Modal> : null}
    {inv ? <InvoiceForm onClose={() => setInv(false)} /> : null}
    {view ? <Modal title={`Invoice ${view.doc.no}`} onClose={() => setView(null)} wide><InvoiceDoc v={view} /><button className={primaryCls} onClick={() => window.print()}>Print / save as PDF</button></Modal> : null}
    
  </>;
}

function InvoiceDoc({ v }: { v: NonNullable<Extract<Awaited<ReturnType<typeof openInvoice>>, { ok: true }>["data"]> }) {
  const { doc, company } = v;
  return <div id="payslip" className="print-area bg-white text-[12.5px] border border-[#E2E8F0] rounded-xl p-6 bg-white">
    <div className="flex justify-between border-b border-[#E2E8F0] pb-3"><div><div className="text-[18px] font-bold">{company.name}</div><div className="text-[#64748B] whitespace-pre-line">{company.address}</div>{company.gstin ? <div>GSTIN {company.gstin}</div> : null}</div><div className="text-right"><div className="text-[16px] font-bold">TAX INVOICE</div><div>{doc.no}</div><div className="text-[#64748B]">{dayLabel(doc.date)}{doc.due ? ` · due ${dayLabel(doc.due)}` : ""}</div></div></div>
    <div className="py-3"><div className="text-[11px] font-semibold text-[#64748B]">BILL TO</div><strong>{doc.client}</strong>{doc.gstin ? <div>GSTIN {doc.gstin}</div> : null}<div className="text-[#64748B]">{doc.address} {doc.state}</div></div>
    <table className="w-full border-collapse"><thead><tr className="bg-[#F8FAFC]">{["Description", "HSN", "Qty", "Rate", "GST", "Amount"].map((h) => <th key={h} className="text-left p-2 text-[11px] uppercase text-[#64748B]">{h}</th>)}</tr></thead><tbody>{doc.items.map((it, i) => <tr key={i} className="border-t border-[#F1F5F9]"><td className="p-2">{it.desc}</td><td className="p-2">{it.hsn}</td><td className="p-2">{it.qty}</td><td className="p-2">{inr(it.rate)}</td><td className="p-2">{it.gst}%</td><td className="p-2">{inr(it.qty * it.rate)}</td></tr>)}</tbody></table>
    <div className="ml-auto w-64 mt-3 text-[13px]"><div className="flex justify-between py-0.5"><span>Taxable value</span><span>{inr(doc.taxable)}</span></div>{doc.intra ? <><div className="flex justify-between py-0.5"><span>CGST</span><span>{inr(doc.tax / 2)}</span></div><div className="flex justify-between py-0.5"><span>SGST</span><span>{inr(doc.tax / 2)}</span></div></> : <div className="flex justify-between py-0.5"><span>IGST</span><span>{inr(doc.tax)}</span></div>}<div className="flex justify-between border-t border-[#E2E8F0] mt-1 pt-1 font-bold text-[15px]"><span>Total</span><span>{inr(doc.total)}</span></div></div>
    {doc.notes ? <p className="mt-3 text-[#64748B]">{doc.notes}</p> : null}{company.bank ? <p className="mt-2 text-[#64748B]">Bank: {company.bank}</p> : null}
  </div>;
}
function InvoiceForm({ onClose }: { onClose: () => void }) {
  const { run, busy } = useRun();
  const [v, setV] = useState({ client: "", gstin: "", address: "", state: "", due: "", notes: "" }), [items, setItems] = useState([{ desc: "", hsn: "9983", qty: "1", rate: "", gst: "18" }]);
  const sub = items.reduce((a, i) => a + (Number(i.qty) || 0) * (Number(i.rate) || 0), 0), tax = items.reduce((a, i) => a + ((Number(i.qty) || 0) * (Number(i.rate) || 0) * Number(i.gst)) / 100, 0);
  const upd = (i: number, k: string, val: string) => setItems(items.map((x, j) => (j === i ? { ...x, [k]: val } : x)));
  const send = (draft: boolean) => run(() => createInvoice({ ...v, draft, items: items.map((i) => ({ desc: i.desc, hsn: i.hsn, qty: Number(i.qty), rate: Number(i.rate), gst: Number(i.gst) })) }), (r) => { onClose(); return `Invoice ${r.no} ${draft ? "saved as draft" : "created"}.`; });
  return <Modal title="New GST invoice" onClose={onClose} wide>
    <div className="flex flex-col gap-3">
      <Grid n={3}><Field label="Client"><input className={inputCls} value={v.client} onChange={(e) => setV({ ...v, client: e.target.value })} required /></Field><Field label="Client GSTIN"><input className={inputCls} value={v.gstin} onChange={(e) => setV({ ...v, gstin: e.target.value })} /></Field><Field label="Client state" hint="Different from your state → IGST"><input className={inputCls} value={v.state} onChange={(e) => setV({ ...v, state: e.target.value })} /></Field><Field label="Address"><input className={inputCls} value={v.address} onChange={(e) => setV({ ...v, address: e.target.value })} /></Field><Field label="Due date"><input className={inputCls} type="date" value={v.due} onChange={(e) => setV({ ...v, due: e.target.value })} /></Field></Grid>
      {items.map((it, i) => <div key={i} className="grid gap-2 items-end" style={{ gridTemplateColumns: "2fr 80px 70px 100px 80px 30px" }}>
        <Field label={i ? "" : "Item"}><input className={inputCls} aria-label="Item description" value={it.desc} onChange={(e) => upd(i, "desc", e.target.value)} /></Field><Field label={i ? "" : "HSN/SAC"}><input className={inputCls} aria-label="HSN" value={it.hsn} onChange={(e) => upd(i, "hsn", e.target.value)} /></Field><Field label={i ? "" : "Qty"}><input className={inputCls} aria-label="Quantity" inputMode="decimal" value={it.qty} onChange={(e) => upd(i, "qty", e.target.value)} /></Field><Field label={i ? "" : "Rate ₹"}><input className={inputCls} aria-label="Rate" inputMode="decimal" value={it.rate} onChange={(e) => upd(i, "rate", e.target.value)} /></Field>
        <Field label={i ? "" : "GST"}><select className={inputCls} aria-label="GST rate" value={it.gst} onChange={(e) => upd(i, "gst", e.target.value)}>{GST_RATES.map((g) => <option key={g} value={g}>{g}%</option>)}</select></Field><button type="button" className={cx(dangerCls, "!px-2 h-9")} aria-label="Remove item" disabled={items.length === 1} onClick={() => setItems(items.filter((_, j) => j !== i))}>×</button></div>)}
      <div><button type="button" className={btnCls} onClick={() => setItems([...items, { desc: "", hsn: "9983", qty: "1", rate: "", gst: "18" }])}>+ Add item</button></div>
      <Field label="Notes"><input className={inputCls} value={v.notes} onChange={(e) => setV({ ...v, notes: e.target.value })} /></Field>
      <div className="flex items-center gap-3 flex-wrap"><div className="flex-1 text-[13px]">Taxable {inr(sub)} · GST {inr(tax)} · <strong>Total {inr(Math.round(sub + tax))}</strong></div><button className={btnCls} disabled={busy} onClick={() => send(true)}>Save draft</button><button className={primaryCls} disabled={busy} onClick={() => send(false)}>Create invoice</button></div>
    </div></Modal>;
}

export function FinReports({ d }: { d: Data<"fin_reports"> }) {
  const s = d.sum, profit = s.pnl.income - s.pnl.expenses - s.pnl.payroll;
  return <>
    <Grid n={4}><Stat l="Net profit" v={lakh(profit)} c={profit < 0 ? "#DC2626" : undefined} /><Stat l="Income (ex-GST)" v={lakh(s.pnl.income)} /><Stat l="Bills & expenses" v={lakh(s.pnl.expenses)} c="#B45309" /><Stat l="Payroll" v={lakh(s.pnl.payroll)} c="#B45309" /></Grid>
    <Grid n={2}>
      <Card title="Profit & loss" sub="From sent invoices, bills and processed payroll" pad>{[["Income", s.pnl.income], ["Bills & expenses", -s.pnl.expenses], ["Payroll (gross)", -s.pnl.payroll]].map(([k, v]) => <div key={k as string} className="flex justify-between py-1.5 text-[13.5px] border-t border-[#F1F5F9] first:border-0"><span>{k}</span><strong>{inr(v as number)}</strong></div>)}<div className="flex justify-between py-2 mt-1 border-t-2 border-[#0f172a] text-[14.5px] font-bold"><span>Net</span><span>{inr(profit)}</span></div></Card>
      <Card title="Receivables ageing" right={<button className={btnCls} onClick={() => download("ageing.csv", ["Invoice,Client,Amount,Date,Status", ...s.ageing.map((a) => [a.no, `"${a.client}"`, a.amount, a.on, a.status].join(","))].join("\n"))}>↓ Export</button>}><Table head={["Invoice", "Client", "Amount", "Date", "Status"]} empty={s.ageing.length ? undefined : "Nothing outstanding."}>{s.ageing.map((a) => <tr key={a.no}><td className={tdCls}>{a.no}</td><td className={tdCls}>{a.client}</td><td className={tdCls}>{inr(a.amount)}</td><td className={tdCls}>{dayLabel(a.on)}</td><td className={tdCls}><Pill tone={statusTone(a.status)}>{a.status}</Pill></td></tr>)}</Table></Card>
    </Grid></>;
}
export function FinGst({ d }: { d: Data<"fin_gst"> }) {
  const g = d.sum.gst, out = g.reduce((a, x) => a + x.output, 0), inp = g.reduce((a, x) => a + x.input, 0);
  return <>
    <Grid n={3}><Stat l="Output GST" v={inr(out)} /><Stat l="Input GST (bills)" v={inr(inp)} c="#0f172a" /><Stat l="Net payable" v={inr(out - inp)} c="#B45309" /></Grid>
    <Card title="Month by month" sub="Output from sent invoices, input from the GST column of bills" right={<button className={btnCls} onClick={() => download("gst-summary.csv", ["Month,Output GST,Input GST,Net payable", ...g.map((x) => [x.month, x.output, x.input, x.payable].join(","))].join("\n"))}>↓ Export</button>}><Table head={["Month", "Output GST", "Input GST", "Net payable"]} empty={g.length ? undefined : "No invoices or bills yet."}>{g.map((x) => <tr key={x.month}><td className={tdCls}>{x.month}</td><td className={tdCls}>{inr(x.output)}</td><td className={tdCls}>{inr(x.input)}</td><td className={tdCls}><strong>{inr(x.payable)}</strong></td></tr>)}</Table></Card>
    <p className="text-[12px] text-[#64748B] text-center">Filing GSTR-1 and GSTR-3B is done on the GST portal; use this summary and the exports to prepare them.</p></>;
}

export function WorkflowsScreen({ d }: { d: Data<"fin_workflows"> }) {
  const { run } = useRun();
  const runs = d.wf.reduce((a, w) => a + w.runs, 0);
  return <>
    <Grid n={3}><Stat l="Active rules" v={d.wf.filter((w) => w.on).length} sub={`of ${d.wf.length}`} /><Stat l="Times they have run" v={runs} c="#0f172a" /><Stat l="Last run" v={d.wf.map((w) => w.last).filter(Boolean).sort().pop()?.slice(0, 10) ? dayLabel(d.wf.map((w) => w.last).filter(Boolean).sort().pop()!) : "—"} c="#0f172a" /></Grid>
    <Card title="Automation rules" sub="Every rule here really runs. Switch one off and it stops."><Table head={["Rule", "When", "Then", "Runs", "Last run", "On"]}>
      {d.wf.map((w) => <tr key={w.id}><td className={tdCls}><strong>{w.name}</strong></td><td className={tdCls}>{w.trigger}</td><td className={tdCls}>{w.action}</td><td className={tdCls}>{w.runs}</td><td className={tdCls}>{w.last ? dayLabel(w.last) : "—"}</td>
        <td className={tdCls}><button role="switch" aria-checked={w.on} aria-label={`${w.name}: ${w.on ? "on" : "off"}`} onClick={() => run(() => setWorkflow(w.id, !w.on))} className={cx("w-11 h-6 rounded-full relative cursor-pointer border-0", w.on ? "bg-[#14B8A6]" : "bg-[#CBD5E1]")}><span className={cx("absolute top-0.5 size-5 rounded-full bg-white transition-all", w.on ? "left-[22px]" : "left-0.5")} /></button></td></tr>)}
    </Table></Card></>;
}
