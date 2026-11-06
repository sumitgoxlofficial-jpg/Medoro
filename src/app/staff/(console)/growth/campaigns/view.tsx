"use client";
import { useState } from "react";
import { STAGES } from "@/staff/growth/constants";
import { approveCampaign, audiencePreview, cancelCampaign, createCampaign } from "../../../growth-actions";
import { Empty, Panel, Pill, btn, btnPrimary, fieldCls, lbl, td, th, useRun } from "../../ui";
import { fmtDT } from "../kit";

type C = { id: string; code: string; name: string; channel: string; status: string; dailyCap: number; createdBy: string; createdByName: string; approvedByName: string; createdAt: string; stats: Record<string, number> };
type T = { id: string; channel: string; name: string; language: string; status: string };
const ST: Record<string, [string, string]> = { pending_approval: ["#FFF4E0", "#94570A"], running: ["#E1F1EF", "#0B5E5B"], completed: ["#E3F5EC", "#18794E"], cancelled: ["#EEF0F2", "#3D454D"] };

export function CampaignsView({ campaigns, templates, states, canApprove, me }: { campaigns: C[]; templates: T[]; states: string[]; canApprove: boolean; me: string }) {
  const { run, busy } = useRun();
  const [f, setF] = useState({ name: "", channel: "whatsapp", templateId: "", dailyCap: "200", state: "", district: "", pin: "", stage: "", verification: "" });
  const [prev, setPrev] = useState<{ matched: number; eligible: number; excluded: Record<string, number> } | null>(null);
  const audience = Object.fromEntries(Object.entries({ state: f.state, district: f.district, pin: f.pin, stage: f.stage, verification: f.verification }).filter(([, v]) => v));
  const tpl = templates.filter((t) => t.channel === f.channel);
  return (
    <>
      <Panel title="New campaign" sub="Goes only to leads with recorded consent for the channel and no opt-out. A super admin approves before anything is sent; sending is capped per day.">
        <div className="grid gap-2.5 p-4 grid-cols-2 min-[900px]:grid-cols-4">
          <label className={lbl + " col-span-2"}>Name<input className={fieldCls} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
          <label className={lbl}>Channel<select className={fieldCls} value={f.channel} onChange={(e) => { setF({ ...f, channel: e.target.value, templateId: "" }); setPrev(null); }}><option value="whatsapp">WhatsApp</option><option value="email">Email</option></select></label>
          <label className={lbl}>Template<select className={fieldCls} value={f.templateId} onChange={(e) => setF({ ...f, templateId: e.target.value })}><option value="">Choose</option>{tpl.map((t) => <option key={t.id} value={t.id}>{t.name} ({t.language}) · {t.status}</option>)}</select></label>
          <label className={lbl}>State<select className={fieldCls} value={f.state} onChange={(e) => setF({ ...f, state: e.target.value })}><option value="">Any</option>{states.map((s) => <option key={s}>{s}</option>)}</select></label>
          <label className={lbl}>District<input className={fieldCls} value={f.district} onChange={(e) => setF({ ...f, district: e.target.value })} /></label>
          <label className={lbl}>PIN<input className={fieldCls} maxLength={6} value={f.pin} onChange={(e) => setF({ ...f, pin: e.target.value })} /></label>
          <label className={lbl}>Stage<select className={fieldCls} value={f.stage} onChange={(e) => setF({ ...f, stage: e.target.value })}><option value="">Any</option>{STAGES.filter(([v]) => v !== "DO_NOT_CONTACT").map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
          <label className={lbl}>Daily cap<input className={fieldCls} inputMode="numeric" value={f.dailyCap} onChange={(e) => setF({ ...f, dailyCap: e.target.value })} /></label>
        </div>
        <div className="flex gap-2 px-4 pb-4 flex-wrap items-center">
          <button className={btn} disabled={busy} onClick={() => run(() => audiencePreview(f.channel as "email", audience), setPrev)}>Preview audience</button>
          <button className={btnPrimary} disabled={busy || !f.name || !f.templateId} onClick={() => run(() => createCampaign({ name: f.name, channel: f.channel as "email", templateId: f.templateId, audience, dailyCap: f.dailyCap }), () => setPrev(null))}>Create and send for approval</button>
          {prev ? <span className="text-[13px]"><strong>{prev.eligible}</strong> of {prev.matched} matching leads can receive it{Object.keys(prev.excluded).length ? ` · excluded: ${Object.entries(prev.excluded).map(([k, n]) => `${k} ${n}`).join(", ")}` : ""}</span> : null}
        </div>
      </Panel>
      <Panel title="Campaigns">
        {campaigns.length ? (
          <div className="overflow-auto"><table className="w-full border-collapse min-w-[980px] text-[13px]">
            <thead><tr className="bg-[#FAFBFB] text-muted text-[12px]"><th className={th}>Campaign</th><th className={th}>Status</th><th className={th + " text-right"}>Queued</th><th className={th + " text-right"}>Sent</th><th className={th + " text-right"}>Delivered</th><th className={th + " text-right"}>Read</th><th className={th + " text-right"}>Replied</th><th className={th + " text-right"}>Failed</th><th className={th + " text-right"}>Skipped</th><th className={th}>By</th><th className={th}></th></tr></thead>
            <tbody>{campaigns.map((c) => { const s = c.stats; return (
              <tr key={c.id}>
                <td className={td}><strong>{c.code}</strong> {c.name}<div className="text-muted text-[11.5px]">{c.channel} · cap {c.dailyCap}/day · {fmtDT(c.createdAt)}</div></td>
                <td className={td}><Pill bg={(ST[c.status] ?? ["#EEF0F2", "#3D454D"])[0]} fg={(ST[c.status] ?? ["#EEF0F2", "#3D454D"])[1]}>{c.status.replace("_", " ")}</Pill></td>
                {["queued", "sent", "delivered", "read", "replied", "failed", "skipped"].map((k) => <td key={k} className={td + " text-right tnum"}>{s[k] ?? 0}</td>)}
                <td className={td}>{c.createdByName}{c.approvedByName ? <div className="text-muted text-[11.5px]">approved by {c.approvedByName}</div> : null}</td>
                <td className={td + " whitespace-nowrap"}>
                  {c.status === "pending_approval" && canApprove ? <button className={btn + " inline-flex"} disabled={busy} onClick={() => { if (window.confirm(`${c.createdBy === me ? "You created this campaign. " : ""}Approve ${c.code}? I reviewed the message and the audience, and only consented contacts will get it.`)) run(() => approveCampaign(c.id, true)); }}>Approve</button> : null}
                  {["pending_approval", "running"].includes(c.status) ? <button className={btn + " inline-flex ml-1"} disabled={busy} onClick={() => run(() => cancelCampaign(c.id))}>Cancel</button> : null}
                </td>
              </tr>
            ); })}</tbody>
          </table></div>
        ) : <Empty>No campaigns yet. No promotional messages are sent during setup.</Empty>}
      </Panel>
    </>
  );
}
