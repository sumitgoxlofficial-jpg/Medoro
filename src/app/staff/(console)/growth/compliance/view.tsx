"use client";
import { useState } from "react";
import Link from "next/link";
import { liftSuppression, runRetention, suppress } from "../../../growth-actions";
import { Empty, Kpi, Panel, Pill, Tabs, btn, btnPrimary, fieldCls, selSm, td, th, useRun } from "../../ui";
import { fmtDT, fmtD } from "../kit";

type O = {
  consents: { id: string; leadId: string; channel: string; purpose: string; lawfulBasis: string; evidence: string; source: string; grantedAt: string; revokedAt: string | null; revokeNote: string | null }[];
  suppressions: { id: string; channel: string; hint: string; reason: string; leadId: string | null; createdAt: string; liftedAt: string | null; liftNote: string | null }[];
  audit: { id: string; at: string; staffName: string; action: string; entity: string; detail: string; ip: string | null }[];
  activeConsents: Record<string, number>;
  policy: { callPolicy: string; retentionMonths: number; campaignDailyCap: number };
  retention: { months: number; count: number; sample: { id: string; code: string; name: string; updatedAt: string }[] };
  leads: Record<string, { id: string; code: string; name: string }>;
};

export function ComplianceView({ o, canManage }: { o: O; canManage: boolean }) {
  const { run, busy } = useRun();
  const [tab, setTab] = useState<"dnc" | "consent" | "retention" | "audit">("dnc");
  const [s, setS] = useState({ value: "", channel: "all", reason: "manual" });
  const lead = (id: string | null) => (id && o.leads[id] ? <Link className="text-teal" href={`/staff/growth/leads/${id}`}>{o.leads[id].name}</Link> : "—");
  return (
    <>
      <div className="grid gap-3 grid-cols-2 min-[1000px]:grid-cols-4">
        <Kpi l="Active do-not-contact entries" v={String(o.suppressions.filter((x) => !x.liftedAt).length)} />
        <Kpi l="Active WhatsApp consents" v={String(o.activeConsents.whatsapp ?? 0)} d={`${o.activeConsents.email ?? 0} email · ${o.activeConsents.phone ?? 0} phone`} />
        <Kpi l="Call policy" v={o.policy.callPolicy === "dnc_only" ? "Block DNC" : "Authorised only"} d="Change it in Settings" />
        <Kpi l="Retention" v={o.retention.months ? `${o.retention.months} months` : "Off"} d={`${o.retention.count} leads past it`} />
      </div>
      <section className="bg-white border border-[#E6E8EB] rounded-xl p-4 text-[12.5px] text-muted flex flex-col gap-1">
        <strong className="text-ink text-[13.5px]">How Medoro handles contact data</strong>
        <span>Business contact details only, with their source; no patient or pharmacy-customer data ever enters Growth Intelligence. A publicly listed number does not by itself permit promotional messages: WhatsApp and email campaigns go only to recorded consents, and every opt-out (STOP, unsubscribe link, call request, bounce) lands on the do-not-contact list, which is kept as a hash so it survives erasure. See docs/growth-engine/compliance.md for DPDP and TRAI notes, including the risk of promotional calls from personal numbers.</span>
      </section>
      <Tabs value={tab} options={[["dnc", "Do-not-contact"], ["consent", "Consent records"], ["retention", "Retention & erasure"], ["audit", "Audit log"]]} onChange={setTab} />
      {tab === "dnc" ? (
        <Panel title="Do-not-contact list">
          <form className="flex gap-2 p-4 flex-wrap" onSubmit={(e) => { e.preventDefault(); run(() => suppress(s as never), () => setS({ ...s, value: "" })); }}>
            <input className={fieldCls + " !w-[240px]"} value={s.value} onChange={(e) => setS({ ...s, value: e.target.value })} placeholder="Phone or email" />
            <select className={selSm} value={s.channel} onChange={(e) => setS({ ...s, channel: e.target.value })}><option value="all">All channels</option><option value="phone">Calls</option><option value="whatsapp">WhatsApp</option><option value="email">Email</option></select>
            <select className={selSm} value={s.reason} onChange={(e) => setS({ ...s, reason: e.target.value })}><option value="manual">Manual</option><option value="dnc_request">Asked not to be contacted</option><option value="complaint">Complaint</option></select>
            <button className={btnPrimary} disabled={busy || s.value.length < 5}>Add</button>
          </form>
          {o.suppressions.length ? (
            <div className="overflow-auto"><table className="w-full border-collapse min-w-[700px] text-[13px]">
              <thead><tr className="bg-[#FAFBFB] text-muted text-[12px]"><th className={th}>Contact</th><th className={th}>Channel</th><th className={th}>Reason</th><th className={th}>Lead</th><th className={th}>Added</th><th className={th}></th></tr></thead>
              <tbody>{o.suppressions.map((x) => <tr key={x.id} className={x.liftedAt ? "text-muted" : ""}><td className={td + " tnum"}>{x.hint}</td><td className={td}>{x.channel}</td><td className={td}>{x.reason}</td><td className={td}>{lead(x.leadId)}</td><td className={td}>{fmtD(x.createdAt)}</td><td className={td}>{x.liftedAt ? `Lifted ${fmtD(x.liftedAt)}: ${x.liftNote}` : canManage ? <button className={btn} disabled={busy} onClick={() => { const n = window.prompt("Why lift this entry? (e.g. written consent received on …)"); if (n) run(() => liftSuppression(x.id, n)); }}>Lift</button> : null}</td></tr>)}</tbody>
            </table></div>
          ) : <Empty>Empty.</Empty>}
        </Panel>
      ) : tab === "consent" ? (
        <Panel title="Consent records" sub="Recorded on the lead page or from call reports. Revoked rows are kept.">
          {o.consents.length ? (
            <div className="overflow-auto"><table className="w-full border-collapse min-w-[860px] text-[13px]">
              <thead><tr className="bg-[#FAFBFB] text-muted text-[12px]"><th className={th}>Lead</th><th className={th}>Channel · purpose</th><th className={th}>Basis</th><th className={th}>Evidence</th><th className={th}>Given</th><th className={th}>Status</th></tr></thead>
              <tbody>{o.consents.map((c) => <tr key={c.id}><td className={td}>{lead(c.leadId)}</td><td className={td}>{c.channel} · {c.purpose}</td><td className={td}>{c.lawfulBasis}</td><td className={td}>{c.evidence} <span className="text-muted">({c.source})</span></td><td className={td}>{fmtD(c.grantedAt)}</td><td className={td}>{c.revokedAt ? <Pill bg="#FBEAE9" fg="#C0362C">Revoked {fmtD(c.revokedAt)}</Pill> : <Pill bg="#E3F5EC" fg="#18794E">Active</Pill>}</td></tr>)}</tbody>
            </table></div>
          ) : <Empty>No consents recorded yet.</Empty>}
        </Panel>
      ) : tab === "retention" ? (
        <Panel title="Retention" sub={o.retention.months ? `Leads with no activity for ${o.retention.months} months that never reached a trial or conversion` : "Retention is off (Settings)."}>
          {o.retention.sample.map((l) => <div key={l.id} className="px-4 py-2 border-t border-[#F1F3F4] text-[13px]"><Link className="text-teal" href={`/staff/growth/leads/${l.id}`}>{l.code} · {l.name}</Link> <span className="text-muted">· last change {fmtD(l.updatedAt)}</span></div>)}
          {o.retention.count ? <div className="p-4 flex gap-2 items-center">{canManage ? <button className={btn} disabled={busy} onClick={() => { if (window.confirm(`Erase the personal data of ${o.retention.count} leads past retention? Hashed do-not-contact entries are kept.`)) run(() => runRetention(), (n) => `${n} leads erased.`); }}>Erase {o.retention.count} leads</button> : null}<span className="text-muted text-[12.5px]">Preview above; nothing is erased until you confirm.</span></div> : <Empty>Nothing past retention.</Empty>}
          <div className="px-4 pb-4 text-[12.5px] text-muted">An individual erasure request: open the lead and use “Erase personal data”.</div>
        </Panel>
      ) : (
        <Panel title="Audit log" sub="Append-only">
          <div className="overflow-auto"><table className="w-full border-collapse min-w-[860px] text-[12.5px]">
            <thead><tr className="bg-[#FAFBFB] text-muted text-[12px]"><th className={th}>When</th><th className={th}>Who</th><th className={th}>Action</th><th className={th}>Detail</th><th className={th}>IP</th></tr></thead>
            <tbody>{o.audit.map((x) => <tr key={x.id}><td className={td + " whitespace-nowrap"}>{fmtDT(x.at)}</td><td className={td}>{x.staffName}</td><td className={td}>{x.action}</td><td className={td + " max-w-[480px]"}>{x.detail}</td><td className={td}>{x.ip ?? ""}</td></tr>)}</tbody>
          </table></div>
        </Panel>
      )}
    </>
  );
}
