"use client";
import { useState } from "react";
import { approveTemplate, saveTemplate, syncWaTemplates } from "../../../growth-actions";
import { Empty, Panel, Pill, btn, btnPrimary, fieldCls, lbl, useRun } from "../../ui";

type T = { id: string; name: string; language: string; category: string; subject: string; body: string; status: string };
const ST: Record<string, [string, string]> = { approved: ["#E3F5EC", "#18794E"], pending: ["#FFF4E0", "#94570A"], rejected: ["#FBEAE9", "#C0362C"], draft: ["#EEF0F2", "#3D454D"] };

export function TemplatesView({ channel, templates, canApprove, connected }: { channel: "whatsapp" | "email"; templates: T[]; canApprove: boolean; connected: boolean }) {
  const { run, busy } = useRun();
  const [f, setF] = useState({ name: "", language: "en", category: "MARKETING", subject: "", body: "" });
  return (
    <>
      <Panel title="Templates" right={channel === "whatsapp" ? <button className={btn} disabled={busy || !connected} onClick={() => run(() => syncWaTemplates(), (n) => `${n} templates synced from Meta.`)}>Sync from Meta</button> : null}>
        {templates.length ? templates.map((t) => (
          <div key={t.id} className="px-4 py-3 border-t border-[#F1F3F4] text-[13.5px] flex gap-3 items-start">
            <div className="flex-1 min-w-0"><strong>{t.name}</strong> <span className="text-muted">· {t.language} · {t.category}</span> <Pill bg={(ST[t.status] ?? ST.draft)[0]} fg={(ST[t.status] ?? ST.draft)[1]}>{t.status}</Pill>
              {t.subject ? <div className="text-muted">Subject: {t.subject}</div> : null}<div className="whitespace-pre-wrap text-[13px] mt-1">{t.body}</div></div>
            {canApprove && t.status !== "approved" ? <button className={btn} disabled={busy} onClick={() => run(() => approveTemplate(t.id))}>Approve</button> : null}
          </div>
        )) : <Empty>No templates yet.</Empty>}
      </Panel>
      <Panel title={channel === "whatsapp" ? "Draft a WhatsApp template" : "New email template"} sub={channel === "whatsapp" ? "Variables: {{1}} pharmacy name, {{2}} city, {{3}} your first name. Submit the same text in Meta WhatsApp Manager; once Meta approves it, press Sync." : "Variables: {{pharmacy}}, {{city}}, {{owner}} (only when verified), {{me}}. A postal address and unsubscribe link are added to every email."}>
        <form className="grid gap-2.5 p-4 grid-cols-2 min-[900px]:grid-cols-4" onSubmit={(e) => { e.preventDefault(); run(() => saveTemplate({ channel, ...f } as never), () => setF({ name: "", language: "en", category: "MARKETING", subject: "", body: "" })); }}>
          <label className={lbl}>Name<input className={fieldCls} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="medoro_intro_v1" /></label>
          <label className={lbl}>Language<select className={fieldCls} value={f.language} onChange={(e) => setF({ ...f, language: e.target.value })}><option value="en">English</option><option value="en_IN">English (India)</option><option value="hi">Hindi</option></select></label>
          <label className={lbl}>Category<select className={fieldCls} value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}><option value="MARKETING">Marketing</option><option value="UTILITY">Utility</option></select></label>
          {channel === "email" ? <label className={lbl}>Subject<input className={fieldCls} value={f.subject} onChange={(e) => setF({ ...f, subject: e.target.value })} /></label> : <span />}
          <label className={lbl + " col-span-2 min-[900px]:col-span-4"}>Body<textarea rows={5} className={fieldCls} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} /></label>
          <div><button className={btnPrimary} disabled={busy}>Save draft</button></div>
        </form>
      </Panel>
    </>
  );
}
