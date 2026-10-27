"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { MessageCircle, Phone, Plus, Search, X } from "lucide-react";
import { CUSTOMER_STATUS, PRIORITY, PRODUCTS, TICKET_CATEGORIES, TICKET_CHANNELS, TICKET_STATUS, product, type StaffRoleId } from "@/staff/constants";
import { addNote, addTrialCustomer, createTicket, requestRemote, setCustomerStatus } from "../../actions";
import { Empty, Pill, Tabs, btn, btnPrimary, fieldCls, fmtDay, fmtTime, lbl, panel, selSm, td, th, useRun } from "../ui";

type Row = { id: string; code: string; name: string; owner: string; phone: string; email: string; city: string; gstin: string; product: string; addons: string[]; cycle: string; status: string; openTickets: number };
type Detail = NonNullable<Awaited<ReturnType<typeof import("@/staff/support").customerDetail>>>;
const SC: Record<string, [string, string]> = { active: ["#E7F6EE", "#18794E"], trial: ["#EAF0FC", "#2459C9"], grace: ["#FDF2E1", "#94570A"], cancelled: ["#F2F4F5", "#5B636B"] };
const plan = (p: string, addons: string[], cycle: string) => `${product(p).name}${addons.includes("ai") ? " + AI" : ""} · ${cycle === "y" ? "Yearly" : "Monthly"}`;
const phoneFmt = (p: string) => `+91 ${p.slice(0, 5)} ${p.slice(5)}`;

export function CustomersView({ role, rows, detail }: { role: StaffRoleId; rows: Row[]; detail: Detail | null }) {
  const router = useRouter();
  const { run, busy } = useRun();
  const [q, setQ] = useState("");
  const [f, setF] = useState<"all" | keyof typeof CUSTOMER_STATUS>("all");
  const [note, setNote] = useState("");
  const [add, setAdd] = useState<null | { name: string; owner: string; phone: string; email: string; city: string; product: string; cycle: string }>(null);
  const [tk, setTk] = useState<null | { subject: string; message: string; priority: string; channel: string; category: string }>(null);
  const list = useMemo(() => rows.filter((c) => (f === "all" || c.status === f) && (!q || [c.name, c.owner, c.phone, c.gstin, c.city, c.code, c.email].join(" ").toLowerCase().includes(q.toLowerCase()))), [rows, f, q]);
  const care = role !== "sales";
  const d = detail;

  return (
    <>
      <div className="flex gap-2.5 flex-wrap items-center">
        <div className="flex items-center gap-2 bg-white border border-input rounded-lg px-2.5 h-[38px] flex-1 min-w-[220px] max-w-[420px]"><Search size={16} className="text-fainter" /><input aria-label="Search customers" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search pharmacy, owner, phone, GSTIN, city" className="border-0 outline-none text-[14px] flex-1 min-w-0" /></div>
        <Tabs value={f} onChange={setF} options={[["all", "All"], ...(Object.entries(CUSTOMER_STATUS) as [keyof typeof CUSTOMER_STATUS, string][])]} />
        {care ? <button className={btnPrimary + " ml-auto"} onClick={() => setAdd({ name: "", owner: "", phone: "", email: "", city: "", product: "pro", cycle: "m" })}><Plus size={16} />Add trial customer</button> : null}
      </div>
      {add ? (
        <form onSubmit={(e) => { e.preventDefault(); run(() => addTrialCustomer(add as never), (id) => { setAdd(null); router.push(`/staff/customers?c=${id}`); }); }} className={panel + " border-teal-line p-[18px] flex flex-col gap-3"}>
          <strong className="text-[15px]">Add a pharmacy on trial</strong>
          <span className="text-[13px] text-muted">For pharmacies that started on their own. Sales-led customers are added when their payment is verified.</span>
          <div className="grid gap-3 grid-cols-[repeat(auto-fit,minmax(180px,1fr))]">
            {([["name", "Pharmacy name"], ["owner", "Owner name"], ["phone", "Owner mobile"], ["email", "Email"], ["city", "City"]] as const).map(([k, l]) => <label key={k} className={lbl}>{l}<input className={fieldCls} value={add[k]} onChange={(e) => setAdd({ ...add, [k]: e.target.value })} /></label>)}
            <label className={lbl}>Plan<select className={fieldCls} value={add.product} onChange={(e) => setAdd({ ...add, product: e.target.value })}>{PRODUCTS.filter((p) => !("addon" in p) && !("once" in p)).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
          </div>
          <div className="flex gap-2 justify-end"><button type="button" className={btn + " px-3.5 py-[9px] text-[14px]"} onClick={() => setAdd(null)}>Cancel</button><button disabled={busy} className={btnPrimary}>Add customer</button></div>
        </form>
      ) : null}

      <div className={`grid gap-4 items-start grid-cols-1 ${d ? "min-[1200px]:grid-cols-[minmax(0,1.4fr)_minmax(340px,1fr)]" : ""}`}>
        <div className={panel + " overflow-auto"}>
          <table className="w-full border-collapse min-w-[620px] text-[13.5px]">
            <thead><tr className="bg-[#FAFBFB] text-muted text-[12px]"><th className={th}>Pharmacy</th><th className={th}>Owner</th><th className={th}>Plan</th><th className={th}>Status</th><th className={th + " text-right"}>Open tickets</th></tr></thead>
            <tbody>{list.map((c) => (
              <tr key={c.id} onClick={() => router.push(`/staff/customers?c=${c.id}`)} className={`cursor-pointer hover:bg-[#F7FAFA] ${d?.id === c.id ? "bg-[#F2F9F8]" : ""}`}>
                <td className={td}><div className="font-semibold">{c.name}</div><div className="text-[12px] text-muted">{c.code}{c.city ? ` · ${c.city}` : ""}</div></td>
                <td className={td}>{c.owner || "—"}<div className="text-[12px] text-muted">{phoneFmt(c.phone)}</div></td>
                <td className={td}>{plan(c.product, c.addons, c.cycle)}</td>
                <td className={td}><Pill bg={SC[c.status][0]} fg={SC[c.status][1]}>{CUSTOMER_STATUS[c.status as keyof typeof CUSTOMER_STATUS]}</Pill></td>
                <td className={td + " text-right"}>{c.openTickets}</td>
              </tr>
            ))}</tbody>
          </table>
          {!list.length ? <Empty>{rows.length ? "No pharmacies match that search." : role === "sales" ? "No customers yet. They appear here when a sale you logged is verified." : "No customers yet. They appear when a sale is verified, or add a trial customer."}</Empty> : null}
        </div>

        {d ? (
          <div className={panel + " flex flex-col"}>
            <div className="p-4 border-b border-[#EEF0F2] flex flex-col gap-1">
              <div className="flex gap-2 items-center"><strong className="text-[16px]">{d.name}</strong><Pill bg={SC[d.status][0]} fg={SC[d.status][1]}>{CUSTOMER_STATUS[d.status as keyof typeof CUSTOMER_STATUS]}</Pill><Link href="/staff/customers" aria-label="Close" className="ml-auto text-muted flex"><X size={18} /></Link></div>
              <span className="text-[12.5px] text-muted">{d.code} · customer since {fmtDay(d.since)}</span>
            </div>
            <div className="px-4 pt-3 pb-1 flex gap-2.5 items-center">
              <span className="size-11 rounded-full flex items-center justify-center text-[13px] font-bold flex-none" style={{ border: `4px solid ${d.health >= 70 ? "#18794E" : d.health >= 45 ? "#94570A" : "#C0362C"}` }}>{d.health}</span>
              <div className="flex flex-col leading-[1.3]"><strong className="text-[13.5px]" style={{ color: d.health >= 70 ? "#18794E" : d.health >= 45 ? "#94570A" : "#C0362C" }}>{d.health >= 70 ? "Healthy" : d.health >= 45 ? "Needs attention" : "At risk"} · health {d.health}/100</strong>
                <span className="text-[12px] text-muted">{({ active: "Paying", trial: `Trial${d.renewsOn ? ` ends ${fmtDay(d.renewsOn)}` : ""} · nudge to convert`, grace: "Payment failed · send the payment link", cancelled: "Read-only · win-back candidate" } as Record<string, string>)[d.status]}{d.highOpen ? ` · ${d.highOpen} high-priority ticket open` : ""}</span></div>
            </div>
            <div className="px-4 py-1.5">
              {([["Owner", d.owner || "—"], ["Mobile", phoneFmt(d.phone)], ["Email", d.email || "—"], ["Address", [d.address, d.city].filter(Boolean).join(", ") || "—"], ["GSTIN", d.gstin || "—"], ["Drug licence", d.drugLicence || "—"], ["Plan", plan(d.product, d.addons, d.cycle)], ["Renewal", d.renewsOn ? fmtDay(d.renewsOn) : "—"], ["Branches / devices", `${d.branches} / ${d.devices}`], ["Deployment", d.deployment || "—"], ["Licence check-in", d.lastCheckIn ? fmtTime(d.lastCheckIn) : "Not reported"], ["App version", d.appVersion ?? "—"], ["Salesperson", d.salesperson ?? "—"]] as const).map(([l, v]) => (
                <div key={l} className="flex justify-between gap-3 py-2 border-b border-[#F5F6F7] text-[13.5px]"><span className="text-muted">{l}</span><span className="text-right font-medium">{v}</span></div>
              ))}
              {role === "super_admin" ? (
                <div className="flex justify-between gap-3 py-2 text-[13.5px] items-center"><span className="text-muted">Change status</span>
                  <select aria-label="Customer status" className={selSm} value={d.status} onChange={(e) => run(() => setCustomerStatus(d.id, e.target.value))}>{Object.entries(CUSTOMER_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
              ) : null}
            </div>
            {care ? (
              <div className="px-4 py-3 border-t border-[#EEF0F2] flex flex-col gap-2">
                <div className="flex items-center"><strong className="text-[13.5px]">Tickets</strong>{!tk ? <button className={btn + " ml-auto"} onClick={() => setTk({ subject: "", message: "", priority: "medium", channel: "Phone", category: "General" })}><Plus size={14} />New ticket</button> : null}</div>
                {tk ? (
                  <form onSubmit={(e) => { e.preventDefault(); run(() => createTicket({ customerId: d.id, ...tk } as never), (id) => { setTk(null); router.push(`/staff/tickets?t=${id}`); }); }} className="flex flex-col gap-2 bg-[#FAFBFB] border border-[#EEF0F2] rounded-lg p-2.5">
                    <input aria-label="Subject" className={fieldCls} placeholder="Subject" value={tk.subject} onChange={(e) => setTk({ ...tk, subject: e.target.value })} />
                    <textarea aria-label="What the customer said" className={fieldCls} rows={2} placeholder="What the customer said (optional)" value={tk.message} onChange={(e) => setTk({ ...tk, message: e.target.value })} />
                    <div className="grid grid-cols-3 gap-2">
                      <select aria-label="Priority" className={fieldCls} value={tk.priority} onChange={(e) => setTk({ ...tk, priority: e.target.value })}>{Object.entries(PRIORITY).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
                      <select aria-label="Channel" className={fieldCls} value={tk.channel} onChange={(e) => setTk({ ...tk, channel: e.target.value })}>{TICKET_CHANNELS.map((c) => <option key={c}>{c}</option>)}</select>
                      <select aria-label="Category" className={fieldCls} value={tk.category} onChange={(e) => setTk({ ...tk, category: e.target.value })}>{TICKET_CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select>
                    </div>
                    <div className="flex gap-2 justify-end"><button type="button" className={btn} onClick={() => setTk(null)}>Cancel</button><button disabled={busy} className={btnPrimary + " py-1.5"}>Open ticket</button></div>
                  </form>
                ) : null}
                {d.tickets.length ? d.tickets.map((t) => (
                  <Link key={t.id} href={`/staff/tickets?t=${t.id}`} className="flex justify-between gap-2.5 border border-[#EEF0F2] rounded-lg px-2.5 py-2 text-[13px] text-ink hover:text-ink"><span>{t.code} · {t.subject}</span><span className="font-semibold whitespace-nowrap" style={{ color: t.status === "resolved" ? "#18794E" : t.status === "waiting" ? "#94570A" : "#C0362C" }}>{TICKET_STATUS[t.status as keyof typeof TICKET_STATUS]}</span></Link>
                )) : <span className="text-[13px] text-muted">No tickets yet.</span>}
              </div>
            ) : null}
            <div className="px-4 py-3 border-t border-[#EEF0F2] flex flex-col gap-2">
              <strong className="text-[13.5px]">Notes</strong>
              {d.notes.map((n) => <div key={n.id} className="text-[13px] bg-[#F7F8F9] rounded-lg px-2.5 py-2"><div>{n.text}</div><div className="text-[11.5px] text-muted">{n.by} · {fmtTime(n.at)}</div></div>)}
              <form onSubmit={(e) => { e.preventDefault(); run(() => addNote(d.id, note), () => setNote("")); }} className="flex gap-1.5"><input aria-label="Note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add a note for the team" className={fieldCls + " py-2"} /><button disabled={busy} className={btnPrimary + " py-2"}>Add</button></form>
              <div className="flex gap-1.5 flex-wrap">
                <a href={`https://wa.me/91${d.phone}`} target="_blank" rel="noreferrer" className={btn + " py-[7px]"}><MessageCircle size={14} className="text-[#18794E]" />WhatsApp</a>
                <a href={`tel:+91${d.phone}`} className={btn + " py-[7px]"}><Phone size={14} />Call</a>
                <button disabled={busy} className={btn + " py-[7px]"} onClick={() => run(() => addNote(d.id, note, true), () => setNote(""))}>Log call</button>
                {care ? <button disabled={busy || d.remote?.status === "requested"} className={btn + " py-[7px]"} onClick={() => run(() => requestRemote(d.id))}>{d.remote?.status === "requested" ? "Remote access: waiting for owner" : "Request remote access"}</button> : null}
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </>
  );
}
