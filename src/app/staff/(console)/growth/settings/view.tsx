"use client";
import { useState } from "react";
import { savePolicy, saveSource } from "../../../growth-actions";
import { Panel, btn, btnPrimary, fieldCls, lbl, td, th, useRun } from "../../ui";

type S = { id: string; key: string; name: string; kind: string; licence: string; attribution: string; termsUrl: string; allowsExport: boolean; active: boolean };

export function SettingsView({ policy, sources }: { policy: { callPolicy: string; retentionMonths: number; campaignDailyCap: number }; sources: S[] }) {
  const { run, busy } = useRun();
  const [p, setP] = useState({ callPolicy: policy.callPolicy, retentionMonths: String(policy.retentionMonths), campaignDailyCap: String(policy.campaignDailyCap) });
  const [n, setN] = useState({ name: "", kind: "public_directory", licence: "", attribution: "", termsUrl: "", allowsExport: true });
  return (
    <>
      <Panel title="Contact policy">
        <div className="grid gap-3 p-4 min-[900px]:grid-cols-3">
          <label className={lbl}>Calls
            <select className={fieldCls} value={p.callPolicy} onChange={(e) => setP({ ...p, callPolicy: e.target.value })}>
              <option value="dnc_only">Allowed unless on the do-not-contact list</option>
              <option value="authorized_only">Only with recorded permission (or Contact authorised stage)</option>
            </select>
          </label>
          <label className={lbl}>Retention for inactive leads (months, 0 = off)<input className={fieldCls} inputMode="numeric" value={p.retentionMonths} onChange={(e) => setP({ ...p, retentionMonths: e.target.value })} /></label>
          <label className={lbl}>Campaign messages per day (all campaigns)<input className={fieldCls} inputMode="numeric" value={p.campaignDailyCap} onChange={(e) => setP({ ...p, campaignDailyCap: e.target.value })} /></label>
        </div>
        <div className="px-4 pb-4 flex gap-2 items-center"><button className={btnPrimary} disabled={busy} onClick={() => run(() => savePolicy(p as never))}>Save policy</button><span className="text-[12.5px] text-muted">Promotional WhatsApp and email always need recorded consent; this isn’t configurable.</span></div>
      </Panel>
      <Panel title="Lead sources" sub="Licence and attribution travel with every lead; exports leave out sources whose terms don’t allow it.">
        <div className="overflow-auto"><table className="w-full border-collapse min-w-[860px] text-[13px]">
          <thead><tr className="bg-[#FAFBFB] text-muted text-[12px]"><th className={th}>Source</th><th className={th}>Kind</th><th className={th}>Licence</th><th className={th}>Attribution</th><th className={th}>Export</th><th className={th}>Active</th></tr></thead>
          <tbody>{sources.map((s) => <tr key={s.id}><td className={td}><strong>{s.name}</strong>{s.termsUrl ? <div><a className="text-teal text-[12px]" href={s.termsUrl} target="_blank" rel="noopener noreferrer">terms</a></div> : null}</td><td className={td}>{s.kind}</td><td className={td}>{s.licence}</td><td className={td}>{s.attribution}</td>
            <td className={td}><button className={btn} disabled={busy} onClick={() => run(() => saveSource({ ...s, kind: s.kind as "upload", allowsExport: !s.allowsExport }))}>{s.allowsExport ? "Allowed" : "Not allowed"}</button></td>
            <td className={td}><button className={btn} disabled={busy} onClick={() => run(() => saveSource({ ...s, kind: s.kind as "upload", active: !s.active }))}>{s.active ? "Yes" : "No"}</button></td></tr>)}</tbody>
        </table></div>
        <form className="grid gap-2.5 p-4 grid-cols-2 min-[900px]:grid-cols-3 border-t border-[#EEF0F2]" onSubmit={(e) => { e.preventDefault(); run(() => saveSource(n as never), () => setN({ ...n, name: "", licence: "", attribution: "", termsUrl: "" })); }}>
          <label className={lbl}>New source name<input className={fieldCls} value={n.name} onChange={(e) => setN({ ...n, name: e.target.value })} /></label>
          <label className={lbl}>Kind<select className={fieldCls} value={n.kind} onChange={(e) => setN({ ...n, kind: e.target.value })}><option value="public_directory">Official public directory</option><option value="official_api">Official API</option><option value="provider">Licensed provider</option><option value="submitted">Submitted by pharmacies</option><option value="upload">Other list</option></select></label>
          <label className={lbl}>Licence<input className={fieldCls} value={n.licence} onChange={(e) => setN({ ...n, licence: e.target.value })} /></label>
          <label className={lbl}>Attribution<input className={fieldCls} value={n.attribution} onChange={(e) => setN({ ...n, attribution: e.target.value })} /></label>
          <label className={lbl}>Terms URL<input className={fieldCls} value={n.termsUrl} onChange={(e) => setN({ ...n, termsUrl: e.target.value })} /></label>
          <div className="flex items-end"><button className={btnPrimary} disabled={busy || n.name.trim().length < 3}>Add source</button></div>
        </form>
      </Panel>
    </>
  );
}
