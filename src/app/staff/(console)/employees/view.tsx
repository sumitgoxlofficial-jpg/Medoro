"use client";
import { useState } from "react";
import { Copy, UserPlus } from "lucide-react";
import { ROLE_LABEL, type StaffRoleId } from "@/staff/constants";
import { createEmployee, resetEmployeeSignIn, setEmployeeStatus } from "../../actions";
import { Panel, Pill, btn, btnPrimary, fieldCls, lbl, td, th, useRun } from "../ui";

type Row = { id: string; empNo: string; name: string; email: string; phone: string; role: StaffRoleId; team: string; status: string; referralCode: string | null; totpEnabled: boolean };
const ROLE_C: Record<StaffRoleId, [string, string]> = { super_admin: ["#0E1A1F", "#fff"], sales: ["#E1F1EF", "#0B5E5B"], care: ["#EAF0FC", "#2459C9"] };
const ST: Record<string, [string, string]> = { active: ["Active", "#18794E"], invited: ["Invited", "#2459C9"], pending: ["Pending approval", "#94570A"], deactivated: ["Deactivated", "#8A929A"] };

export function EmployeesView({ meId, rows }: { meId: string; rows: Row[] }) {
  const { run, busy } = useRun();
  const [form, setForm] = useState<null | { name: string; email: string; phone: string; role: StaffRoleId; team: string }>(null);
  const [link, setLink] = useState<{ who: string; url: string } | null>(null);
  const pending = rows.filter((r) => r.status === "pending").length;
  const set = (k: string, v: string) => setForm((f) => (f ? { ...f, [k]: v } : f));

  return (
    <>
      <div className="flex gap-2.5 flex-wrap items-center">
        <span className="text-[13.5px] text-muted">{rows.length} employee{rows.length === 1 ? "" : "s"} · {pending} waiting for approval</span>
        <button onClick={() => setForm({ name: "", email: "", phone: "", role: "sales", team: "" })} className={btnPrimary + " ml-auto"}><UserPlus size={16} />Create employee profile</button>
      </div>
      {link ? (
        <div className="bg-[#F2F9F8] border border-teal-line rounded-xl p-4 flex flex-col gap-2">
          <strong className="text-[14px]">Invite link for {link.who}</strong>
          <span className="text-[13px] text-ink-2">Send this link privately (it works once, for 7 days). They set a password, then an authenticator app on first sign-in.</span>
          <div className="flex gap-2 items-center"><code className="flex-1 min-w-0 truncate bg-white border border-line rounded-md px-2.5 py-1.5 text-[12.5px]">{link.url}</code>
            <button className={btn} onClick={() => navigator.clipboard?.writeText(link.url)}><Copy size={14} />Copy</button><button className={btn} onClick={() => setLink(null)}>Done</button></div>
        </div>
      ) : null}
      {form ? (
        <form onSubmit={(e) => { e.preventDefault(); run(() => createEmployee(form), (d) => { setForm(null); setLink({ who: form.name, url: d.link }); return `${d.empNo} created.`; }); }} className="bg-white border border-teal-line rounded-xl p-[18px] flex flex-col gap-3">
          <strong className="text-[15px]">New employee profile</strong>
          <div className="grid gap-3 grid-cols-[repeat(auto-fit,minmax(200px,1fr))]">
            <label className={lbl}>Full name<input className={fieldCls} value={form.name} onChange={(e) => set("name", e.target.value)} /></label>
            <label className={lbl}>Work email<input className={fieldCls} value={form.email} onChange={(e) => set("email", e.target.value)} placeholder="name@medoro.in" /></label>
            <label className={lbl}>Mobile<input className={fieldCls} value={form.phone} onChange={(e) => set("phone", e.target.value)} inputMode="tel" /></label>
            <label className={lbl}>Role<select className={fieldCls} value={form.role} onChange={(e) => set("role", e.target.value)}>{(Object.keys(ROLE_LABEL) as StaffRoleId[]).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</select></label>
            <label className={lbl}>Team / region<input className={fieldCls} value={form.team} onChange={(e) => set("team", e.target.value)} placeholder="Pune West" /></label>
          </div>
          <div className="flex gap-2 justify-end"><button type="button" className={btn + " px-3.5 py-[9px] text-[14px]"} onClick={() => setForm(null)}>Cancel</button><button type="submit" disabled={busy} className={btnPrimary}>Create profile &amp; get invite link</button></div>
        </form>
      ) : null}
      <Panel>
        <div className="overflow-auto"><table className="w-full border-collapse min-w-[860px] text-[13.5px]">
          <thead><tr className="bg-[#FAFBFB] text-muted text-[12px]"><th className={th}>Employee</th><th className={th}>Role</th><th className={th}>Team</th><th className={th}>Referral code</th><th className={th}>Status</th><th className={th + " text-right"}>Action</th></tr></thead>
          <tbody>{rows.map((e) => {
            const [sl, sc] = ST[e.status] ?? [e.status, "#5B636B"];
            return (
              <tr key={e.id}>
                <td className={td}><div className="font-semibold">{e.name}</div><div className="text-[12px] text-muted">{e.empNo} · {e.email} · {e.phone}</div></td>
                <td className={td}><Pill bg={ROLE_C[e.role][0]} fg={ROLE_C[e.role][1]}>{ROLE_LABEL[e.role]}</Pill></td>
                <td className={td}>{e.team || "—"}</td>
                <td className={td + " font-mono text-[12.5px]"}>{e.referralCode ?? "—"}</td>
                <td className={td}><span className="font-semibold" style={{ color: sc }}>{sl}</span>{e.status === "active" && !e.totpEnabled ? <div className="text-[11.5px] text-muted">authenticator not set up yet</div> : null}</td>
                <td className={td + " text-right"}>
                  {e.id === meId ? <span className="text-muted text-[12.5px]">You</span> : (
                    <div className="flex gap-1.5 justify-end">
                      {e.status === "pending" ? <button disabled={busy} className={btn} onClick={() => run(() => setEmployeeStatus(e.id, "approve"), () => `${e.name} approved.`)}>Approve</button> : null}
                      {e.status === "deactivated" ? <button disabled={busy} className={btn} onClick={() => run(() => setEmployeeStatus(e.id, "reactivate"), () => `${e.name} is active again.`)}>Reactivate</button> : (
                        <>
                          {e.status !== "pending" ? <button disabled={busy} className={btn} onClick={() => { if (confirm(`Reset ${e.name}'s password and authenticator? They are signed out everywhere.`)) run(() => resetEmployeeSignIn(e.id), (d) => { setLink({ who: e.name, url: d.link }); return "Sign-in reset."; }); }}>Reset sign-in</button> : null}
                          <button disabled={busy} className={btn + " text-[#C0362C]"} onClick={() => { if (confirm(`Deactivate ${e.name}? Their sessions end now.`)) run(() => setEmployeeStatus(e.id, "deactivate"), () => `${e.name} was deactivated and signed out.`); }}>{e.status === "pending" ? "Decline" : "Deactivate"}</button>
                        </>
                      )}
                    </div>
                  )}
                </td>
              </tr>
            );
          })}</tbody>
        </table></div>
      </Panel>
    </>
  );
}
