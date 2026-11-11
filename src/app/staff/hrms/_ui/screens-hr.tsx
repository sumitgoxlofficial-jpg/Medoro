"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Data, Shell } from "@/staff/hrms/screens";
import { CAND_STAGES, CLAIM_STATUS, EMP_TYPES, HR_ROLE_LABEL, JOB_TYPES, LEAVE_TYPES, MODULES, ONBOARD_STEPS, PRIORITIES, inr, leaveLabel, monthLabel } from "@/staff/hrms/constants";
import { adminDecideClaim, assignTask, bankFile, createEmployee, decideCorrection, decideLeave, deleteDepartment, deleteTask, grantLeave, hrDecideClaim, issueOneTimePassword, moveCandidate, payrollReport, postJob, previewOfficialEmail, processPayroll, recognise, saveDepartment, saveOffer, scoreCandidate, setEmployeeActive, setJobOpen, tickOnboarding, togglePerm, updateEmployee, addCandidate, saveSettings } from "../actions";
import { Avatar, Card, Empty, Field, Grid, Modal, Pill, Stat, Table, Tabs, ago, btnCls, cx, dangerCls, dayLabel, dayLong, download, inputCls, presenceColor, primaryCls, statusTone, tdCls, timeLabel, useRun } from "./kit";
import { AnnounceModal, PayslipView } from "./screens-me";

type P = { sh: Shell };

// ── HR and super admin dashboards
export function DashboardScreen({ d, sh }: { d: Data<"hrhome"> } & P) {
  const { run } = useRun();
  const [ann, setAnn] = useState(false);
  const away = d.staff.filter((p) => p.presence !== "offline" || p.status === "active").slice(0, 12);
  return (
    <>
      <Card title="Team availability · live" right={<Pill tone="amber">{d.staff.filter((p) => p.presence === "break").length} on break</Pill>} pad>
        <div className="grid gap-2.5" style={{ gridTemplateColumns: "repeat(auto-fill,minmax(230px,1fr))" }}>
          {away.map((p) => <div key={p.id} className="flex items-center gap-2.5 border border-[#E2E8F0] rounded-xl px-3 py-2"><Avatar name={p.name} photo={p.photo} size={34} dot={presenceColor(p.presence)} /><div className="min-w-0 flex-1"><div className="text-[13px] font-semibold truncate">{p.name}</div><div className="text-[11.5px] text-[#64748B] truncate">{p.designation || p.dept || "—"}</div></div><Pill tone={p.presence === "active" ? "green" : p.presence === "break" ? "amber" : "gray"}>{p.presence === "active" ? "Working" : p.presence === "break" ? p.presenceNote || "On break" : "Offline"}</Pill></div>)}
        </div>
      </Card>
      <Grid n={4}><Stat l="Headcount" v={d.staff.length} sub={`${d.depts} departments`} /><Stat l="On leave today" v={d.onLeave} c="#B45309" /><Stat l="Pending approvals" v={d.pending.length + d.claimsWaiting} c="#B45309" /><Stat l="Open positions" v={d.openJobs} c="#0f172a" /></Grid>
      <Grid n={2}>
        {d.canApprove ? <Card title="Pending approvals" pad>
          {d.pending.length ? d.pending.map((a) => <div key={a.kind + a.id} className="flex items-center gap-3 border border-[#E2E8F0] rounded-xl px-3.5 py-2.5 mb-2"><Avatar name={a.name} size={34} /><div className="flex-1 min-w-0"><div className="text-[13.5px] font-semibold">{a.name}</div><div className="text-[12px] text-[#64748B]">{a.text}</div></div>
            {a.mine && sh.me.role !== "admin" ? <Pill tone="gray">Your own</Pill> : <><button className={primaryCls} onClick={() => run(() => (a.kind === "leave" ? decideLeave(a.id, true) : decideCorrection(a.id, true)))}>Approve</button><button className={dangerCls} onClick={() => run(() => (a.kind === "leave" ? decideLeave(a.id, false) : decideCorrection(a.id, false)))}>Reject</button></>}</div>) : <Empty>Nothing waiting.</Empty>}
          {d.claimsWaiting ? <Link className="text-[13px] font-semibold text-[#0B5E5B]" href={`/staff/hrms/${sh.me.role === "admin" ? "saapprovals" : "hrleave"}`}>{d.claimsWaiting} reimbursement claim{d.claimsWaiting > 1 ? "s" : ""} waiting →</Link> : null}
        </Card> : null}
        <Card title="Joining this week" pad>{d.joining.length ? d.joining.map((p) => <div key={p.id} className="flex items-center gap-3 py-2"><Avatar name={p.name} size={32} /><div className="flex-1"><div className="text-[13.5px] font-semibold">{p.name}</div><div className="text-[12px] text-[#64748B]">{p.designation} · {dayLabel(p.joinDate!)}</div></div><Pill tone={p.docsAccepted ? "green" : "amber"}>{p.docsAccepted ? "Ready" : "Docs pending"}</Pill></div>) : <Empty>No one joining this week.</Empty>}</Card>
      </Grid>
      <Card title="Announcements" right={d.canPost ? <button className={btnCls} onClick={() => setAnn(true)}>+ Post</button> : null} pad>{d.ann.length ? d.ann.map((a) => <div key={a.id} className="py-2 border-t border-[#F1F5F9] first:border-0 text-[13px]"><strong>{a.emoji} {a.title}</strong> <span className="text-[#94A3B8] text-[11.5px]">{ago(a.at)}</span><div className="text-[#64748B]">{a.body}</div></div>) : <Empty>No announcements yet.</Empty>}</Card>
      <EmployeeTable people={d.staff} />
      {ann ? <AnnounceModal onClose={() => setAnn(false)} /> : null}
    </>
  );
}
function EmployeeTable({ people }: { people: Data<"hremployees">["people"] }) {
  const [q, setQ] = useState("");
  const list = people.filter((p) => `${p.name} ${p.dept} ${p.empNo}`.toLowerCase().includes(q.toLowerCase()));
  return <Card title="Employee database" right={<input className={cx(inputCls, "!w-60")} placeholder="Search name or department…" value={q} onChange={(e) => setQ(e.target.value)} />}>
    <Table head={["Name", "Department", "Designation", "Status"]} empty={list.length ? undefined : "No match."}>{list.map((p) => <tr key={p.id}><td className={tdCls}><strong>{p.name}</strong> <span className="text-[#94A3B8] text-[12px]">{p.empNo}</span></td><td className={tdCls}>{p.dept || "—"}</td><td className={tdCls}>{p.designation || "—"}</td><td className={tdCls}><Pill tone={statusTone(p.status)}>{p.status === "invited" ? (p.joinDate && p.joinDate > new Date().toISOString().slice(0, 10) ? `Joining ${dayLabel(p.joinDate)}` : "Not signed in yet") : p.status}</Pill></td></tr>)}</Table></Card>;
}

// ── Employees
type Person = Data<"hremployees">["people"][number];
export function EmployeesScreen({ d }: { d: Data<"hremployees"> }) {
  const { run, busy } = useRun();
  const [q, setQ] = useState(""), [edit, setEdit] = useState<Person | null>(null), [otp, setOtp] = useState<{ otp: string; name: string; empNo: string } | null>(null), [bal, setBal] = useState<Person | null>(null);
  const list = d.people.filter((p) => `${p.name} ${p.dept} ${p.empNo} ${p.email}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <>
      <Card title="Employee directory" sub={`${d.people.filter((p) => p.status !== "deactivated").length} active · ${d.depts.length} departments`} right={<><input className={cx(inputCls, "!w-56")} placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} /><Link href="/staff/hrms/hrnewemp" className={primaryCls}>+ Create employee profile</Link></>}>
        <Table head={["Name", "Department", "Designation", "Access", "Status", ""]} empty={list.length ? undefined : "No match."}>
          {list.map((p) => <tr key={p.id}><td className={tdCls}><div className="flex items-center gap-2.5"><Avatar name={p.name} photo={p.photo} size={30} /><div><strong>{p.name}</strong><div className="text-[11.5px] text-[#94A3B8]">{p.empNo} · {p.email}</div></div></div></td><td className={tdCls}>{p.dept || "—"}</td><td className={tdCls}>{p.designation || "—"}</td><td className={tdCls}>{HR_ROLE_LABEL[p.role]}</td><td className={tdCls}><Pill tone={statusTone(p.status)}>{p.status === "invited" ? "Not signed in" : p.status}</Pill></td>
            <td className={tdCls}><div className="flex gap-1.5 flex-wrap"><button className={btnCls} onClick={() => setEdit(p)}>Edit</button><button className={btnCls} onClick={() => setBal(p)}>Leave</button>{p.status !== "deactivated" ? <button className={btnCls} onClick={() => run(() => issueOneTimePassword(p.id), (o) => { setOtp(o); })}>Reset password</button> : null}{p.id !== d.meId ? (p.status === "deactivated" ? <button className={btnCls} onClick={() => run(() => setEmployeeActive(p.id, true))}>Reactivate</button> : <button className={dangerCls} onClick={() => { if (confirm(`Deactivate ${p.name}? They are signed out everywhere.`)) run(() => setEmployeeActive(p.id, false)); }}>Deactivate</button>) : null}</div></td></tr>)}
        </Table>
      </Card>
      {edit ? <EditModal p={edit} d={d} onClose={() => setEdit(null)} busy={busy} run={run} /> : null}
      {bal ? <LeaveModal p={bal} onClose={() => setBal(null)} /> : null}
      {otp ? <Modal title="One-time password" onClose={() => setOtp(null)}><p className="text-[13.5px]">Give this to {otp.name} ({otp.empNo}). It works for one sign-in within 24 hours; they then set a new password.</p><code className="block text-center text-[22px] font-bold tracking-wider bg-[#F1F5F9] rounded-xl py-3 select-all">{otp.otp}</code><button className={btnCls} onClick={() => navigator.clipboard?.writeText(otp.otp)}>Copy</button><p className="text-[12px] text-[#64748B]">It isn’t stored anywhere readable. Close this and it can’t be shown again.</p></Modal> : null}
    </>
  );
}
function EditModal({ p, d, onClose, run, busy }: { p: Person; d: Data<"hremployees">; onClose: () => void; run: ReturnType<typeof useRun>["run"]; busy: boolean }) {
  const [v, setV] = useState({ dept: p.dept, designation: p.designation, role: p.role === "admin" ? "employee" : p.role, empType: p.empType, location: p.location, managerId: p.managerId ?? "", joinDate: p.joinDate ?? "", ctc: String(p.ctc), incentivePct: String(p.incentivePct), monthlyTarget: String(p.monthlyTarget) });
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setV({ ...v, [k]: e.target.value });
  const isAdmin = p.role === "admin";
  return <Modal title={`Edit ${p.name}`} onClose={onClose} wide>
    <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); run(() => updateEmployee(p.id, { ...v, role: v.role as "employee", empType: v.empType as "Full-time", ctc: Number(v.ctc), incentivePct: Number(v.incentivePct), monthlyTarget: Number(v.monthlyTarget), joinDate: v.joinDate || null, managerId: v.managerId || null }), () => { onClose(); }); }}>
      <Grid n={3}>
        <Field label="Department"><select className={inputCls} value={v.dept} onChange={set("dept")}><option value="">—</option>{d.depts.map((x) => <option key={x.id}>{x.name}</option>)}</select></Field>
        <Field label="Designation"><input className={inputCls} value={v.designation} onChange={set("designation")} required /></Field>
        <Field label="System access"><select className={inputCls} value={isAdmin ? "admin" : v.role} onChange={set("role")} disabled={isAdmin || (!d.isAdmin)}>{isAdmin ? <option value="admin">Super Admin</option> : null}<option value="employee">Employee</option><option value="sales">Sales</option><option value="hr">HR Admin</option><option value="finance">Finance</option></select></Field>
        <Field label="Employment type"><select className={inputCls} value={v.empType} onChange={set("empType")}>{EMP_TYPES.map((t) => <option key={t}>{t}</option>)}</select></Field>
        <Field label="Location"><input className={inputCls} value={v.location} onChange={set("location")} /></Field>
        <Field label="Reports to"><select className={inputCls} value={v.managerId} onChange={set("managerId")}><option value="">—</option>{d.people.filter((x) => x.id !== p.id && x.status === "active").map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></Field>
        <Field label="Date of joining"><input className={inputCls} type="date" value={v.joinDate} onChange={set("joinDate")} /></Field>
        <Field label="Annual CTC (₹)"><input className={inputCls} inputMode="numeric" value={v.ctc} onChange={set("ctc")} /></Field>
        {v.role === "sales" || p.role === "sales" ? <><Field label="Sales incentive %" hint="Max 5%"><input className={inputCls} inputMode="decimal" value={v.incentivePct} onChange={set("incentivePct")} /></Field><Field label="Monthly target (pharmacies)"><input className={inputCls} inputMode="numeric" value={v.monthlyTarget} onChange={set("monthlyTarget")} /></Field></> : null}
      </Grid>
      <button className={primaryCls} disabled={busy}>Save</button>
    </form></Modal>;
}
function LeaveModal({ p, onClose }: { p: Person; onClose: () => void }) {
  const { run, busy } = useRun();
  const [t, setT] = useState("casual"), [n, setN] = useState("1");
  return <Modal title={`Leave balance · ${p.name}`} onClose={onClose}><p className="text-[13px] text-[#64748B]">Add (or remove, with a minus) days on top of the yearly policy, e.g. a comp off.</p>
    <form className="flex gap-2 items-end" onSubmit={(e) => { e.preventDefault(); run(() => grantLeave(p.id, t, Number(n)), () => { onClose(); }); }}><Field label="Type"><select className={inputCls} value={t} onChange={(e) => setT(e.target.value)}>{LEAVE_TYPES.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}</select></Field><Field label="Days"><input className={cx(inputCls, "!w-24")} type="number" value={n} onChange={(e) => setN(e.target.value)} /></Field><button className={primaryCls} disabled={busy}>Apply</button></form></Modal>;
}

export function NewEmployeeScreen({ d }: { d: Data<"hrnewemp"> }) {
  const { run, busy } = useRun();
  const blank = { name: "", personalEmail: "", phone: "", dept: d.depts[0]?.name ?? "", designation: "", role: "employee", empType: "Full-time", joinDate: "", ctc: "", location: "", managerId: "", incentivePct: "0" };
  const [v, setV] = useState(blank), [email, setEmail] = useState(""), [made, setMade] = useState<{ empNo: string; email: string; temp: string; mailed: boolean; name: string } | null>(null);
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setV({ ...v, [k]: e.target.value });
  const preview = async (name: string) => { if (name.trim().split(/\s+/).length < 2) return setEmail(""); const r = await previewOfficialEmail(name); if (r.ok) setEmail(r.data); };
  return (
    <>
      <div className="grid gap-3.5 grid-cols-[minmax(0,2fr)_minmax(0,1fr)] max-[1000px]:grid-cols-1">
        <Card title="Employee details" sub={`Official email, employee ID and password are generated for you · @${d.domain}`} pad>
          <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); run(() => createEmployee({ ...v, role: v.role as "employee", empType: v.empType as "Full-time", ctc: Number(v.ctc || 0), incentivePct: Number(v.incentivePct || 0), managerId: v.managerId || null }), (r) => { setMade({ ...r, name: v.name }); setV(blank); setEmail(""); }); }}>
            <Grid n={3}>
              <Field label="Full name *"><input className={inputCls} value={v.name} onChange={(e) => { set("name")(e); void preview(e.target.value); }} required /></Field>
              <Field label="Personal email *" hint="Welcome details are sent here"><input className={inputCls} type="email" value={v.personalEmail} onChange={set("personalEmail")} required /></Field>
              <Field label="Mobile *"><input className={inputCls} value={v.phone} onChange={set("phone")} inputMode="tel" required /></Field>
              <Field label="Department *"><select className={inputCls} value={v.dept} onChange={set("dept")}>{d.depts.map((x) => <option key={x.id}>{x.name}</option>)}</select></Field>
              <Field label="Designation *"><input className={inputCls} value={v.designation} onChange={set("designation")} required /></Field>
              <Field label="System access"><select className={inputCls} value={v.role} onChange={set("role")}><option value="employee">Employee</option><option value="sales">Sales</option>{d.isAdmin ? <><option value="hr">HR Admin</option><option value="finance">Finance</option></> : null}</select></Field>
              <Field label="Employment type"><select className={inputCls} value={v.empType} onChange={set("empType")}>{EMP_TYPES.map((t) => <option key={t}>{t}</option>)}</select></Field>
              <Field label="Date of joining *"><input className={inputCls} type="date" value={v.joinDate} onChange={set("joinDate")} required /></Field>
              <Field label="Annual CTC (₹) *"><input className={inputCls} inputMode="numeric" value={v.ctc} onChange={set("ctc")} required /></Field>
              <Field label="Work location"><input className={inputCls} value={v.location} onChange={set("location")} /></Field>
              <Field label="Reporting manager"><select className={inputCls} value={v.managerId} onChange={set("managerId")}><option value="">—</option>{d.managers.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></Field>
              {v.role === "sales" ? <Field label="Sales incentive % (max 5)"><input className={inputCls} inputMode="decimal" value={v.incentivePct} onChange={set("incentivePct")} /></Field> : null}
            </Grid>
            <div><button className={primaryCls} disabled={busy}>Create employee &amp; generate sign-in</button></div>
          </form>
        </Card>
        <Card title="Generated by the system" pad>
          <div className="text-[11px] font-semibold text-[#64748B] tracking-wide">OFFICIAL EMAIL</div><code className="text-[14px]">{email || `firstname.lastname@${d.domain}`}</code>
          <div className="text-[11px] font-semibold text-[#64748B] tracking-wide mt-3">EMPLOYEE ID</div><code className="text-[14px]">Next in sequence (MS-###)</code>
          <div className="text-[11px] font-semibold text-[#64748B] tracking-wide mt-3">TEMPORARY PASSWORD</div><code className="text-[14px]">Shown once after you create the profile</code>
          <p className="text-[12.5px] text-[#64748B] mt-4 border-t border-[#F1F5F9] pt-3">On first sign-in the employee must set their own password, fill in personal, bank and emergency details, and accept the offer letter, appointment letter and non-disclosure agreement.</p>
        </Card>
      </div>
      {made ? <Modal title={`${made.name} is ready`} onClose={() => setMade(null)}>
        <p className="text-[13.5px]">Share these once, privately. {made.mailed ? "They were also emailed to the personal address." : "Email isn’t set up on this server, so they were not emailed."}</p>
        <div className="bg-[#F1F5F9] rounded-xl p-4 text-[14px] leading-7">Employee ID: <strong>{made.empNo}</strong><br />Official email: <strong>{made.email}</strong><br />Temporary password: <strong className="select-all">{made.temp}</strong></div>
        <div className="flex gap-2"><button className={btnCls} onClick={() => navigator.clipboard?.writeText(`Employee ID: ${made.empNo}\nOfficial email: ${made.email}\nTemporary password: ${made.temp}`)}>Copy</button><Link className={primaryCls} href="/staff/hrms/hremployees">Go to employees</Link></div>
        <p className="text-[12px] text-[#64748B]">The password can’t be shown again. If it’s lost, use Reset password on the employee.</p></Modal> : null}
    </>
  );
}

export function DepartmentsScreen({ d }: { d: Data<"departments"> }) {
  const { run, busy } = useRun();
  const [name, setName] = useState(""), [edit, setEdit] = useState<{ id: string; name: string; headId: string } | null>(null);
  return (
    <Card title="Departments" right={<form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); run(() => saveDepartment({ name }), () => { setName(""); }); }}><input className={cx(inputCls, "!w-48")} placeholder="New department" value={name} onChange={(e) => setName(e.target.value)} required /><button className={primaryCls} disabled={busy}>Add</button></form>}>
      <Table head={["Department", "Head", "People", ""]}>{d.depts.map((x) => <tr key={x.id}><td className={tdCls}><strong>{x.name}</strong></td><td className={tdCls}>{x.head || "—"}</td><td className={tdCls}>{x.count}</td><td className={tdCls}><div className="flex gap-1.5"><button className={btnCls} onClick={() => setEdit({ id: x.id, name: x.name, headId: x.headId ?? "" })}>Edit</button><button className={dangerCls} onClick={() => { if (confirm(`Delete ${x.name}?`)) run(() => deleteDepartment(x.id)); }}>Delete</button></div></td></tr>)}</Table>
      {edit ? <Modal title="Edit department" onClose={() => setEdit(null)}><form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); run(() => saveDepartment({ id: edit.id, name: edit.name, headId: edit.headId || null }), () => { setEdit(null); }); }}><Field label="Name"><input className={inputCls} value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} required /></Field><Field label="Head"><select className={inputCls} value={edit.headId} onChange={(e) => setEdit({ ...edit, headId: e.target.value })}><option value="">—</option>{d.people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field><button className={primaryCls} disabled={busy}>Save</button></form></Modal> : null}
    </Card>
  );
}

export function CredentialsScreen({ d }: { d: Data<"credentials"> }) {
  const { run, busy } = useRun();
  const [who, setWho] = useState(""), [otp, setOtp] = useState<{ otp: string; name: string; empNo: string } | null>(null);
  return (
    <Grid n={2}>
      <Card title="Issue a one-time password" sub="For an employee who forgot theirs. It works for one sign-in, then they set a new password." pad>
        <Field label="Employee"><select className={inputCls} value={who} onChange={(e) => setWho(e.target.value)}><option value="">Choose…</option>{d.people.map((p) => <option key={p.id} value={p.id}>{p.name} · {p.empNo}</option>)}</select></Field>
        <button className={cx(primaryCls, "mt-3")} disabled={busy || !who} onClick={() => run(() => issueOneTimePassword(who), (o) => { setOtp(o); })}>Generate one-time password</button>
        {otp ? <div className="mt-3 bg-[#F2F9F8] border border-[#CFE6E3] rounded-xl p-4"><div className="text-[12.5px] text-[#64748B]">For {otp.name} ({otp.empNo}), valid 24 hours:</div><code className="block text-[22px] font-bold tracking-wider select-all">{otp.otp}</code></div> : null}
      </Card>
      <Card title="Login accounts">
        <Table head={["Employee", "Status", ""]}>{d.people.map((p) => <tr key={p.id}><td className={tdCls}><strong>{p.name}</strong><div className="text-[11.5px] text-[#94A3B8]">{p.empNo} · {p.email}</div></td><td className={tdCls}><Pill tone={!p.hasPassword ? "amber" : p.mustChangePassword ? "amber" : "green"}>{!p.hasPassword ? "No password" : p.mustChangePassword ? "First login pending" : "Active"}</Pill></td><td className={tdCls}>{p.profileDone ? "Profile ✓" : "Profile pending"}{p.docsAccepted ? " · Docs ✓" : ""}</td></tr>)}</Table>
      </Card>
    </Grid>
  );
}

export function OnboardingScreen({ d }: { d: Data<"onboarding"> }) {
  const { run } = useRun();
  return d.joiners.length ? <Grid n={3}>{d.joiners.map((p) => {
    const n = p.onboarding.filter(Boolean).length;
    return <Card key={p.id} pad><div className="flex items-center gap-2.5"><Avatar name={p.name} size={36} /><div className="flex-1"><div className="font-bold text-[14px]">{p.name}</div><div className="text-[12px] text-[#64748B]">{p.designation} · joins {p.joinDate ? dayLabel(p.joinDate) : "—"}</div></div></div>
      <div className="h-1.5 bg-[#E2E8F0] rounded-full mt-3"><div className="h-full bg-[#14B8A6] rounded-full" style={{ width: `${(n * 100) / ONBOARD_STEPS.length}%` }} /></div><div className="text-[11.5px] text-[#64748B] mt-1 mb-2">{n} of {ONBOARD_STEPS.length} tasks done</div>
      {ONBOARD_STEPS.map((s, i) => <label key={s} className="flex items-center gap-2 py-1 text-[13px] cursor-pointer"><input type="checkbox" checked={p.onboarding[i]} onChange={(e) => run(() => tickOnboarding(p.id, i, e.target.checked))} />{s}</label>)}
      <div className="text-[11.5px] text-[#64748B] mt-1">Signed in: {p.hasPassword && !p.mustChangePassword ? "yes" : "not yet"} · Documents: {p.docsAccepted ? "accepted" : "pending"}</div></Card>;
  })}</Grid> : <Card pad><Empty>No new joiners in the last 45 days.</Empty></Card>;
}

// ── Team attendance and leave management
export function HrAttendanceScreen({ d }: { d: Data<"hrattendance"> }) {
  const c = (s: string) => d.rows.filter((r) => r.status === s).length;
  return <>
    <Grid n={4}><Stat l="Present" v={c("Present") + c("Late")} /><Stat l="Late" v={c("Late")} c="#B45309" /><Stat l="On leave" v={c("On leave")} c="#B45309" /><Stat l="Not in yet" v={c("Not in yet")} c="#DC2626" /></Grid>
    <Card title="Today · live attendance" right={<button className={btnCls} onClick={() => download("attendance-today.csv", ["Employee ID,Name,Department,Check-in,Check-out,Status", ...d.rows.map((r) => [r.empNo, r.name, r.dept, r.inAt, r.outAt, r.status].join(","))].join("\n"))}>↓ Export report</button>}>
      <Table head={["Name", "Check-in", "Check-out", "Selfies", "Idle today", "Status"]}>{d.rows.map((r) => <tr key={r.id}><td className={tdCls}><strong>{r.name}</strong> <span className="text-[#94A3B8] text-[12px]">{r.empNo}</span></td><td className={tdCls}>{r.inAt || "—"}</td><td className={tdCls}>{r.outAt || "—"}</td><td className={tdCls}>{r.selfieIn || r.selfieOut ? <span className="flex gap-1.5">{r.selfieIn ? <a href={`/staff/hrms/selfie/${r.selfieIn}`} target="_blank" rel="noreferrer" className="text-[#0B5E5B] font-semibold">in</a> : null}{r.selfieOut ? <a href={`/staff/hrms/selfie/${r.selfieOut}`} target="_blank" rel="noreferrer" className="text-[#0B5E5B] font-semibold">out</a> : null}</span> : "—"}</td><td className={tdCls}>{r.idleMin ? <>{r.idleMin} min{r.idleNow ? <Pill tone="amber">idle now</Pill> : null}</> : "—"}</td><td className={tdCls}><Pill tone={r.status === "Present" ? "green" : r.status === "Late" ? "amber" : r.status === "Not in yet" ? "red" : "gray"}>{r.status}</Pill></td></tr>)}</Table>
    </Card></>;
}
export function HrLeaveScreen({ d, sh }: { d: Data<"hrleave"> } & P) {
  const { run } = useRun();
  const admin = sh.me.role === "admin";
  return <Grid n={2}>
    <Card title="Pending leave & attendance approvals" pad>{d.pending.length ? d.pending.map((a) => <div key={a.kind + a.id} className="flex items-center gap-3 border border-[#E2E8F0] rounded-xl px-3.5 py-2.5 mb-2"><Avatar name={a.name} size={32} /><div className="flex-1 min-w-0"><div className="text-[13.5px] font-semibold">{a.name}</div><div className="text-[12px] text-[#64748B]">{a.text}</div>{a.note ? <div className="text-[12px] italic text-[#64748B]">“{a.note}”</div> : null}</div>{a.mine && !admin ? <Pill tone="gray">Your own</Pill> : <><button className={primaryCls} onClick={() => run(() => (a.kind === "leave" ? decideLeave(a.id, true) : decideCorrection(a.id, true)))}>Approve</button><button className={dangerCls} onClick={() => run(() => (a.kind === "leave" ? decideLeave(a.id, false) : decideCorrection(a.id, false)))}>Reject</button></>}</div>) : <Empty>Nothing waiting.</Empty>}</Card>
    <Card title="On leave this week" pad>{d.out.length ? d.out.map((o) => <div key={o.id} className="flex items-center gap-2.5 py-1.5 text-[13px]"><Avatar name={o.name} size={28} /><span><strong>{o.name}</strong><br /><span className="text-[12px] text-[#64748B]">{dayLabel(o.from)}{o.to !== o.from ? ` – ${dayLabel(o.to)}` : ""} · {leaveLabel(o.type)}</span></span></div>) : <Empty>No one is out.</Empty>}</Card>
    <Card title="Reimbursement claims · HR review" sub="Approve to forward for the super admin’s final sign-off" pad className="col-span-full">
      {d.claims.length ? d.claims.map((c) => <div key={c.id} className="flex items-center gap-3 border border-[#E2E8F0] rounded-xl px-3.5 py-2.5 mb-2 flex-wrap"><div className="flex-1 min-w-[200px]"><div className="text-[13.5px] font-semibold">{c.by} · {c.type}</div><div className="text-[12px] text-[#64748B]">{inr(c.amount)} · {c.note || "no note"} {c.hasBill ? <a className="text-[#0B5E5B] font-semibold" href={`/staff/hrms/bill/${c.id}`} target="_blank" rel="noreferrer">· view bill</a> : <span>· no bill</span>}</div></div>{c.mine && !admin ? <Pill tone="gray">Your own</Pill> : <><button className={primaryCls} onClick={() => run(() => hrDecideClaim(c.id, true))}>Approve → Admin</button><button className={dangerCls} onClick={() => run(() => hrDecideClaim(c.id, false))}>Reject</button></>}</div>) : <Empty>No claims waiting.</Empty>}
    </Card>
    <HolidayAdmin d={d} />
  </Grid>;
}
function HolidayAdmin({ d }: { d: Data<"hrleave"> }) {
  const { run, toast } = useRun();
  const [g, setG] = useState({ id: "", type: "comp", n: "1" });
  return <Card title="Grant leave" sub={`Yearly policy: ${LEAVE_TYPES.map((t) => `${d.policy[t.id]} ${t.short.toLowerCase()}`).join(", ")}. Holidays are managed in Calendar.`} pad className="col-span-full">
    <form className="flex gap-2 items-end flex-wrap" onSubmit={(e) => { e.preventDefault(); if (!g.id) return toast("Choose an employee.", "red"); run(() => grantLeave(g.id, g.type, Number(g.n))); }}>
      <Field label="Employee"><select className={inputCls} value={g.id} onChange={(e) => setG({ ...g, id: e.target.value })}><option value="">Choose…</option>{d.people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
      <Field label="Type"><select className={inputCls} value={g.type} onChange={(e) => setG({ ...g, type: e.target.value })}>{LEAVE_TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}</select></Field>
      <Field label="Days"><input className={cx(inputCls, "!w-24")} type="number" value={g.n} onChange={(e) => setG({ ...g, n: e.target.value })} /></Field><button className={primaryCls}>Apply</button></form></Card>;
}

// ── Payroll
export function PayrollScreen({ d }: { d: Data<"payroll"> }) {
  const router = useRouter();
  const { run, busy } = useRun();
  const r = d.run, [lop, setLop] = useState<Record<string, string>>({}), [slip, setSlip] = useState<Parameters<typeof PayslipView>[0]["s"] | null>(null);
  const tot = (k: "gross" | "net" | "tds" | "pf") => r.lines.reduce((a, l) => a + l[k], 0);
  const get = async (fn: typeof bankFile) => { const x = await fn(r.ym); if (x.ok) download(x.data.name, x.data.text); };
  return <>
    <Grid n={4}><Stat l="Employees" v={r.lines.length} c="#0f172a" /><Stat l="Gross" v={inr(tot("gross"))} /><Stat l="PF + TDS" v={inr(tot("pf") + tot("tds"))} c="#B45309" /><Stat l="Net pay" v={inr(tot("net"))} /></Grid>
    <Card title={`${r.label} payroll run`} sub="PF, ESI, professional tax and TDS are calculated automatically. Absent days are loss of pay." right={<><button className={btnCls} onClick={() => router.push(`/staff/hrms/payroll?m=${d.prev}`)}>‹</button><button className={btnCls} onClick={() => router.push(`/staff/hrms/payroll?m=${d.next}`)}>›</button>
      {r.canProcess ? <button className={primaryCls} disabled={busy} onClick={() => { if (confirm(`Process ${r.label} payroll? This creates payslips for everyone listed and cannot be undone.`)) run(() => processPayroll(r.ym, Object.fromEntries(Object.entries(lop).filter(([, v]) => v !== "").map(([k, v]) => [k, Number(v)]))), (n) => `${n} payslip${n === 1 ? "" : "s"} created.`); }}>Process payroll</button> : null}</>}>
      {r.note ? <Empty>{r.note}</Empty> : null}
      <Table head={["Employee", "Paid days", "LOP", "Gross", "Deductions", "Reimb.", "Net pay", "Status"]}>
        {r.lines.map((l) => <tr key={l.staffId}><td className={tdCls}><strong>{l.name}</strong><div className="text-[11.5px] text-[#94A3B8]">{l.empNo}{!l.hasBank ? " · no bank details" : ""}</div></td><td className={tdCls}>{l.workDays - l.lopDays}/{l.workDays}</td>
          <td className={tdCls}>{l.status === "draft" ? <input className={cx(inputCls, "!w-16 !py-1")} inputMode="numeric" placeholder={String(l.lopDays)} value={lop[l.staffId] ?? ""} onChange={(e) => setLop({ ...lop, [l.staffId]: e.target.value.replace(/\D/g, "") })} aria-label={`Loss-of-pay days for ${l.name}`} /> : l.lopDays}</td>
          <td className={tdCls}>{inr(l.gross)}</td><td className={tdCls} title={`PF ${l.pf} · ESI ${l.esi} · PT ${l.pt} · TDS ${l.tds}`}>{inr(l.pf + l.esi + l.pt + l.tds)}</td><td className={tdCls}>{l.reimburse ? inr(l.reimburse) : "—"}</td><td className={tdCls}><strong>{inr(l.net)}</strong></td><td className={tdCls}><Pill tone={l.status === "paid" ? "green" : "amber"}>{l.status === "paid" ? "Paid" : "Pending"}</Pill></td></tr>)}
      </Table>
      <div className="flex gap-2 p-4 flex-wrap"><button className={btnCls} onClick={() => void get(payrollReport)}>↓ Payroll report (CSV)</button><button className={btnCls} disabled={!r.lines.some((l) => l.status === "paid")} onClick={() => void get(bankFile)}>↓ Bank transfer file</button>{r.lines.find((l) => l.status === "paid") ? <span className="text-[12px] text-[#64748B] self-center">Open a payslip from Reports or ask the employee to view it in Payslips.</span> : null}</div>
    </Card>
    {slip ? <Modal title="Payslip" onClose={() => setSlip(null)} wide><PayslipView s={slip} /></Modal> : null}
  </>;
}

// ── Performance
export function PerfScreen({ d, sh }: { d: Data<"perf"> } & P) {
  const router = useRouter();
  const { run } = useRun();
  const [rec, setRec] = useState<{ id: string; name: string } | null>(null), [note, setNote] = useState("");
  const top = d.rows[0];
  const scored = d.rows.filter((r) => r.score !== null);
  return <>
    <Tabs value={d.period} onChange={(p) => router.push(`/staff/hrms/perf?p=${p}`)} options={[["today", "Today · live"], ["week", "This week"], ["month", "This month"]]} />
    {top && top.score !== null ? <div className="rounded-[18px] px-6 py-5 text-white flex items-center gap-4 flex-wrap" style={{ background: "linear-gradient(135deg,#0B5E5B,#14907F)" }}><Avatar name={top.name} size={56} /><div className="flex-1 min-w-[200px]"><div className="text-[11px] tracking-[.12em] text-[#FCD34D] font-bold">LEADING {d.period === "today" ? "TODAY" : d.period === "week" ? "THIS WEEK" : "THIS MONTH"}</div><div className="text-[22px] font-bold">{top.name}</div><div className="text-[12.5px] text-white/70">{top.dept} · {top.done}/{top.total} tasks · {top.onTimePct ?? 0}% on time</div></div><div className="text-right"><div className="text-[40px] font-bold leading-none">{top.score}</div><div className="text-[11px] text-white/70">performance score</div></div><button className="bg-[#FCD34D] text-[#78350F] rounded-lg px-3 py-2 text-[12.5px] font-bold cursor-pointer border-0" onClick={() => { setRec({ id: top.id, name: top.name }); setNote(""); }}>⭐ Recognise</button></div> : null}
    <Grid n={4}><Stat l="Tasks done" v={`${d.rows.reduce((a, r) => a + r.done, 0)} / ${d.rows.reduce((a, r) => a + r.total, 0)}`} /><Stat l="Team completion" v={`${d.rows.reduce((a, r) => a + r.total, 0) ? Math.round((d.rows.reduce((a, r) => a + r.done, 0) * 100) / d.rows.reduce((a, r) => a + r.total, 0)) : 0}%`} c="#0f172a" /><Stat l="Average score" v={scored.length ? Math.round(scored.reduce((a, r) => a + (r.score ?? 0), 0) / scored.length) : "—"} /><Stat l="On break now" v={d.rows.filter((r) => r.presence === "break").length} c="#B45309" /></Grid>
    <Card title={`Leaderboard · ${d.period === "today" ? "today" : d.period === "week" ? "last 7 days" : "this month"}`} sub="Score = 50% tasks completed, 30% on time, 20% attendance, + kudos" right={<button className={btnCls} onClick={() => download(`performance-${d.period}.csv`, ["Name,Department,Tasks,Done,Completion %,On time %,Attendance %,Kudos,Score", ...d.rows.map((r) => [r.name, r.dept, r.total, r.done, r.completion ?? "", r.onTimePct ?? "", r.attendance ?? "", r.kudos, r.score ?? ""].join(","))].join("\n"))}>↓ Export</button>}>
      <Table head={["#", "Employee", "Tasks", "On time", "Attendance", "Status", "Score", ""]}>{d.rows.map((r, i) => <tr key={r.id}><td className={tdCls}>{i + 1}</td><td className={tdCls}><strong>{r.name}</strong><div className="text-[11.5px] text-[#94A3B8]">{r.designation || r.dept}</div></td><td className={tdCls}>{r.done}/{r.total}</td><td className={tdCls}>{r.onTimePct === null ? "—" : r.onTimePct + "%"}</td><td className={tdCls}>{r.attendance === null ? "—" : r.attendance + "%"}</td><td className={tdCls}><Pill tone={r.presence === "active" ? "blue" : r.presence === "break" ? "amber" : "gray"}>{r.presence === "active" ? "Working" : r.presence === "break" ? "On break" : "Offline"}</Pill></td><td className={tdCls}><strong>{r.score ?? "—"}</strong></td><td className={tdCls}>{r.id !== sh.me.id ? <button className={btnCls} onClick={() => { setRec({ id: r.id, name: r.name }); setNote(""); }}>⭐</button> : null}</td></tr>)}</Table>
    </Card>
    {rec ? <Modal title={`Recognise ${rec.name}`} onClose={() => setRec(null)}><form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); run(() => recognise({ toId: rec.id, note }), () => { setRec(null); }); }}><Field label="What did they do well?"><textarea className={inputCls} rows={3} value={note} onChange={(e) => setNote(e.target.value)} required minLength={3} /></Field><button className={primaryCls}>Send recognition</button></form></Modal> : null}
  </>;
}

// ── Assign tasks and projects
export function AssignTasksScreen({ d }: { d: Data<"assigntasks"> }) {
  const { run, busy } = useRun();
  const [v, setV] = useState({ title: "", assigneeId: "", due: "", priority: "Medium", projectId: "" });
  return <>
    <Card title="Assign a new task" pad><form className="flex gap-2 flex-wrap items-end" onSubmit={(e) => { e.preventDefault(); run(() => assignTask({ ...v, priority: v.priority as "High", projectId: v.projectId || null }), () => { setV({ ...v, title: "" }); }); }}>
      <Field label="Task"><input className={cx(inputCls, "!w-72")} value={v.title} onChange={(e) => setV({ ...v, title: e.target.value })} required /></Field>
      <Field label="For"><select className={inputCls} value={v.assigneeId} onChange={(e) => setV({ ...v, assigneeId: e.target.value })} required><option value="">Choose…</option>{d.people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
      <Field label="Due"><input className={inputCls} type="date" value={v.due} onChange={(e) => setV({ ...v, due: e.target.value })} /></Field>
      <Field label="Priority"><select className={inputCls} value={v.priority} onChange={(e) => setV({ ...v, priority: e.target.value })}>{PRIORITIES.map((p) => <option key={p}>{p}</option>)}</select></Field>
      <Field label="Project"><select className={inputCls} value={v.projectId} onChange={(e) => setV({ ...v, projectId: e.target.value })}><option value="">None</option>{d.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
      <button className={primaryCls} disabled={busy}>+ Assign task</button></form></Card>
    <Card title={`All assigned tasks · ${d.tasks.filter((t) => !t.done).length} open`}>
      <Table head={["Task", "Assigned to", "Due", "Priority", "Status", ""]} empty={d.tasks.length ? undefined : "No tasks yet."}>{d.tasks.map((t) => <tr key={t.id}><td className={tdCls}>{t.title}{t.comment ? <div className="text-[11.5px] italic text-[#64748B]">“{t.comment}”</div> : null}</td><td className={tdCls}>{t.assignee}</td><td className={tdCls}>{t.due ? dayLabel(t.due) : "—"}{t.overdue ? " ⚠" : ""}</td><td className={tdCls}><Pill tone={t.priority === "High" ? "red" : t.priority === "Medium" ? "amber" : "gray"}>{t.priority}</Pill></td><td className={tdCls}><Pill tone={t.done ? "green" : "gray"}>{t.done ? "Done" : "Open"}</Pill></td><td className={tdCls}><button className={dangerCls} onClick={() => run(() => deleteTask(t.id))}>Delete</button></td></tr>)}</Table></Card>
  </>;
}
// ── Recruitment
export function RecruitScreen({ d }: { d: Data<"recruit"> }) {
  const { run, busy } = useRun();
  const [job, setJob] = useState({ title: "", dept: d.depts[0]?.name ?? "", location: "Bokaro", type: "Full-time" }), [cand, setCand] = useState({ jobId: "", name: "", email: "", phone: "", note: "", score: "" });
  const [offer, setOffer] = useState<{ id: string; name: string; position: string; empType: string; pay: string; joinDate: string; mode: string; terms: string } | null>(null), [view, setView] = useState<{ name: string; o: NonNullable<Data<"recruit">["cands"][number]["offer"]> } | null>(null);
  return <>
    <Card title={`Active job openings · ${d.jobs.filter((j) => j.status === "active").length}`} pad>
      {d.jobs.map((j) => <div key={j.id} className="flex items-center gap-3 border border-[#E2E8F0] rounded-xl px-4 py-2.5 mb-2"><div className="flex-1"><strong className="text-[13.5px]">{j.title}</strong><div className="text-[12px] text-[#64748B]">{j.dept} · {j.location} · {j.type}</div></div><span className="text-[12px] text-[#64748B]">{j.applicants} applicants</span><Pill tone={j.status === "active" ? "green" : "gray"}>{j.status}</Pill><button className={btnCls} onClick={() => run(() => setJobOpen(j.id, j.status !== "active"))}>{j.status === "active" ? "Close job" : "Reopen"}</button></div>)}
      <form className="flex gap-2 flex-wrap mt-2" onSubmit={(e) => { e.preventDefault(); run(() => postJob({ ...job, type: job.type as "Full-time" }), () => { setJob({ ...job, title: "" }); }); }}><input className={cx(inputCls, "!w-52")} placeholder="Job title" value={job.title} onChange={(e) => setJob({ ...job, title: e.target.value })} required /><select className={cx(inputCls, "!w-40")} value={job.dept} onChange={(e) => setJob({ ...job, dept: e.target.value })}>{d.depts.map((x) => <option key={x.id}>{x.name}</option>)}</select><input className={cx(inputCls, "!w-32")} value={job.location} onChange={(e) => setJob({ ...job, location: e.target.value })} /><select className={cx(inputCls, "!w-36")} value={job.type} onChange={(e) => setJob({ ...job, type: e.target.value })}>{JOB_TYPES.map((t) => <option key={t}>{t}</option>)}</select><button className={primaryCls} disabled={busy}>+ Post job</button></form>
    </Card>
    <Card title="Add a candidate" sub="HR screening score is out of 100" pad><form className="flex gap-2 flex-wrap" onSubmit={(e) => { e.preventDefault(); run(() => addCandidate({ ...cand, score: cand.score === "" ? null : Number(cand.score) }), () => { setCand({ ...cand, name: "", email: "", phone: "", note: "", score: "" }); }); }}>
      <select className={cx(inputCls, "!w-52")} value={cand.jobId} onChange={(e) => setCand({ ...cand, jobId: e.target.value })} required><option value="">Opening…</option>{d.jobs.filter((j) => j.status === "active").map((j) => <option key={j.id} value={j.id}>{j.title}</option>)}</select>
      <input className={cx(inputCls, "!w-44")} placeholder="Name" value={cand.name} onChange={(e) => setCand({ ...cand, name: e.target.value })} required /><input className={cx(inputCls, "!w-44")} placeholder="Email" value={cand.email} onChange={(e) => setCand({ ...cand, email: e.target.value })} /><input className={cx(inputCls, "!w-32")} placeholder="Phone" value={cand.phone} onChange={(e) => setCand({ ...cand, phone: e.target.value })} /><input className={cx(inputCls, "!w-20")} placeholder="Score" inputMode="numeric" value={cand.score} onChange={(e) => setCand({ ...cand, score: e.target.value.replace(/\D/g, "") })} /><button className={primaryCls} disabled={busy}>Add</button></form></Card>
    <Grid n={4}>{CAND_STAGES.map((s) => <Card key={s.id} title={s.label} right={<Pill tone="gray">{d.cands.filter((c) => c.stage === s.id).length}</Pill>} pad>
      {d.cands.filter((c) => c.stage === s.id).map((c) => <div key={c.id} className="border border-[#E2E8F0] rounded-xl p-2.5 mb-2 text-[12.5px]"><div className="flex justify-between"><strong>{c.name}</strong>{c.score !== null ? <Pill tone="green">Score {c.score}</Pill> : <button className="text-[11.5px] text-[#0B5E5B] cursor-pointer bg-transparent border-0 p-0" onClick={() => { const v = prompt("Screening score (0–100)"); if (v !== null && v !== "") run(() => scoreCandidate(c.id, Number(v))); }}>Add score</button>}</div><div className="text-[#64748B]">{c.role}{c.referredBy ? ` · referred by ${c.referredBy}` : ""}</div>{c.email || c.phone ? <div className="text-[11.5px] text-[#94A3B8]">{c.email} {c.phone}</div> : null}
        <div className="flex gap-1 mt-1.5 flex-wrap">{s.id !== "hired" ? <button className={btnCls} onClick={() => run(() => moveCandidate(c.id, CAND_STAGES[CAND_STAGES.findIndex((x) => x.id === s.id) + 1].id))}>Move to {CAND_STAGES[CAND_STAGES.findIndex((x) => x.id === s.id) + 1].label} →</button> : null}
          {s.id === "offer" || s.id === "interview" ? <button className={btnCls} onClick={() => (c.offer ? setView({ name: c.name, o: c.offer }) : setOffer({ id: c.id, name: c.name, position: c.role, empType: "Full-time", pay: "", joinDate: "", mode: "On-site", terms: "" }))}>{c.offer ? "View offer" : "Offer letter"}</button> : null}
          {s.id === "offer" && c.offer ? <button className={btnCls} onClick={() => setOffer({ id: c.id, name: c.name, ...c.offer! })}>Edit</button> : null}<button className={dangerCls} onClick={() => run(() => moveCandidate(c.id, "rejected"))}>Reject</button></div></div>)}</Card>)}</Grid>
    {offer ? <Modal title={`Offer letter · ${offer.name}`} onClose={() => setOffer(null)}><form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); run(() => saveOffer(offer.id, offer), () => { setOffer(null); }); }}>
      <Grid n={3}><Field label="Position"><input className={inputCls} value={offer.position} onChange={(e) => setOffer({ ...offer, position: e.target.value })} required /></Field><Field label="Type"><select className={inputCls} value={offer.empType} onChange={(e) => setOffer({ ...offer, empType: e.target.value })}>{EMP_TYPES.map((t) => <option key={t}>{t}</option>)}</select></Field><Field label="Pay"><input className={inputCls} value={offer.pay} onChange={(e) => setOffer({ ...offer, pay: e.target.value })} placeholder="₹ 4,80,000 per year" required /></Field><Field label="Joining date"><input className={inputCls} type="date" value={offer.joinDate} onChange={(e) => setOffer({ ...offer, joinDate: e.target.value })} required /></Field><Field label="Mode"><select className={inputCls} value={offer.mode} onChange={(e) => setOffer({ ...offer, mode: e.target.value })}><option>On-site</option><option>Hybrid</option><option>Remote</option></select></Field></Grid>
      <Field label="Other terms"><textarea className={inputCls} rows={3} value={offer.terms} onChange={(e) => setOffer({ ...offer, terms: e.target.value })} /></Field><button className={primaryCls} disabled={busy}>Save offer letter</button></form></Modal> : null}
    {view ? <Modal title="Offer letter" onClose={() => setView(null)} wide><div className="print-area bg-white text-[13.5px] leading-7 border border-[#E2E8F0] rounded-xl p-6"><strong>Medoro</strong> · {dayLabel(view.o.on)}<br /><br />Dear {view.name},<br />We are pleased to offer you the position of <strong>{view.o.position}</strong> ({view.o.empType}, {view.o.mode}) at Medoro, starting <strong>{dayLong(view.o.joinDate)}</strong>, at <strong>{view.o.pay}</strong>.{view.o.terms ? <><br /><br />{view.o.terms}</> : null}<br /><br />Please reply to accept.<br /><br />{view.o.by}, HR</div><button className={primaryCls} onClick={() => window.print()}>Print / save as PDF</button></Modal> : null}
  </>;
}

// ── Reports and Ally usage
export function ReportsScreen({ d }: { d: Data<"reports"> }) {
  return <>
    <Grid n={3}><Stat l="Headcount" v={d.headcount} /><Stat l="Departments" v={d.byDept.length} c="#0f172a" /><Stat l="Month" v={monthLabel(d.month)} c="#0f172a" /></Grid>
    <Grid n={2}>
      <Card title="Headcount by department" pad>{d.byDept.map((x) => <div key={x.dept} className="flex items-center gap-3 py-1 text-[13px]"><span className="w-36 truncate">{x.dept}</span><div className="flex-1 h-2 bg-[#E2E8F0] rounded-full"><div className="h-full bg-[#14B8A6] rounded-full" style={{ width: `${(x.count * 100) / Math.max(1, d.headcount)}%` }} /></div><strong>{x.count}</strong></div>)}</Card>
      <Card title="Payroll by month" pad>{d.months.length ? d.months.map((m) => <div key={m.month} className="flex justify-between py-1 text-[13px]"><span>{monthLabel(m.month)} · {m.count} payslips</span><strong>{inr(m.net)}</strong></div>) : <Empty>No payroll processed yet.</Empty>}</Card>
    </Grid>
    <Card title="Employee report" sub={`Attendance and leave this month (${monthLabel(d.month)}) and leave days this year`} right={<button className={btnCls} onClick={() => download("employees-report.csv", ["Employee ID,Name,Department,Designation,Joined,Status,Days present,Late,Leave days (year),Last check-in", ...d.perPerson.map((p) => [p.empNo, `"${p.name}"`, p.dept, p.designation, p.joinDate, p.status, p.present, p.late, p.leaveDays, p.lastIn].join(","))].join("\n"))}>↓ Export CSV</button>}>
      <Table head={["Employee", "Department", "Present", "Late", "Leave days", "Last check-in"]}>{d.perPerson.map((p) => <tr key={p.id}><td className={tdCls}><strong>{p.name}</strong> <span className="text-[#94A3B8] text-[12px]">{p.empNo}</span></td><td className={tdCls}>{p.dept || "—"}</td><td className={tdCls}>{p.present}</td><td className={tdCls}>{p.late}</td><td className={tdCls}>{p.leaveDays}</td><td className={tdCls}>{p.lastIn ? dayLabel(p.lastIn) : "—"}</td></tr>)}</Table></Card>
  </>;
}
export function AllyUsageScreen({ d }: { d: Data<"allyusage"> }) {
  return <>
    <Grid n={4}><Stat l="Questions (30 days)" v={d.prompts} /><Stat l="People using Ally" v={d.users} c="#0f172a" /><Stat l="Characters exchanged" v={d.chars.toLocaleString("en-IN")} c="#0f172a" /><Stat l="Answered by" v={d.model ?? "Rules"} c="#0f172a" sub={d.model ? "Local model on this server" : "No model on this server: answers come from HR records"} /></Grid>
    <Card title="Usage by person"><Table head={["Employee", "Department", "Questions", "Active days"]} empty={d.people.length ? undefined : "No one has used Ally yet."}>{d.people.map((p) => <tr key={p.id}><td className={tdCls}><strong>{p.name}</strong></td><td className={tdCls}>{p.dept || "—"}</td><td className={tdCls}>{p.prompts}</td><td className={tdCls}>{p.days}</td></tr>)}</Table></Card></>;
}

// ── Super admin
export function ApprovalsScreen({ d }: { d: Data<"saapprovals"> }) {
  const { run } = useRun();
  return <>
    <Card title="Final approvals · Super Admin" sub="HR-approved reimbursement claims awaiting final sign-off" pad>{d.waiting.length ? d.waiting.map((c) => <div key={c.id} className="flex items-center gap-3 border border-[#E2E8F0] rounded-xl px-3.5 py-2.5 mb-2 flex-wrap"><div className="flex-1 min-w-[200px]"><div className="text-[13.5px] font-semibold">{c.by} · {c.type}</div><div className="text-[12px] text-[#64748B]">{inr(c.amount)} · {c.note || "no note"} · ✓ HR approved {c.hasBill ? <a className="text-[#0B5E5B] font-semibold" href={`/staff/hrms/bill/${c.id}`} target="_blank" rel="noreferrer">· view bill</a> : null}</div></div><button className={primaryCls} onClick={() => run(() => adminDecideClaim(c.id, true))}>Approve for payroll</button><button className={dangerCls} onClick={() => run(() => adminDecideClaim(c.id, false))}>Reject</button></div>) : <Empty>Nothing waiting for you.</Empty>}</Card>
    <Card title="Recently settled" pad>{d.settled.length ? d.settled.map((c) => <div key={c.id} className="flex justify-between py-1.5 text-[13px] border-t border-[#F1F5F9] first:border-0"><span>{c.by} · {c.type} · {inr(c.amount)}</span><Pill tone={statusTone(c.status)}>{CLAIM_STATUS[c.status]}{c.paidMonth ? ` · paid ${c.paidMonth}` : ""}</Pill></div>) : <Empty>No settled claims yet.</Empty>}</Card></>;
}
export function PermsScreen({ d }: { d: Data<"saperms"> }) {
  const { run } = useRun();
  const roles = [["hr", "HR Admin"], ["finance", "Finance"], ["sales", "Sales"], ["employee", "Employee"]] as const;
  return <Card title="Permission matrix" sub="Click a cell to grant or revoke a module for a role. Changes are logged. The super admin always has everything." pad>
    <div className="overflow-x-auto"><table className="w-full border-collapse text-[13px]"><thead><tr><th className="text-left p-2" />{MODULES.map((m) => <th key={m.id} className="p-2 text-[11px] uppercase tracking-wide text-[#64748B]">{m.label}</th>)}</tr></thead>
      <tbody>{roles.map(([r, l]) => <tr key={r}><td className="p-2 font-semibold">{l}</td>{MODULES.map((m) => { const on = d.perms[r].includes(m.id); return <td key={m.id} className="p-1"><button aria-label={`${l}: ${m.label} ${on ? "allowed" : "not allowed"}`} aria-pressed={on} onClick={() => run(() => togglePerm(r, m.id))} className={cx("w-full h-9 rounded-lg border cursor-pointer text-[15px]", on ? "bg-[#D6F3EF] border-[#A8E4DC] text-[#0B5E5B]" : "bg-[#F8FAFC] border-[#E2E8F0] text-[#CBD5E1]")}>{on ? "✓" : "—"}</button></td>; })}</tr>)}</tbody></table></div></Card>;
}
export function AuditScreen({ d }: { d: Data<"auditlogs"> }) {
  const [q, setQ] = useState("");
  const rows = d.rows.filter((r) => `${r.who} ${r.action} ${r.detail}`.toLowerCase().includes(q.toLowerCase()));
  return <Card title="Audit log" right={<input className={cx(inputCls, "!w-56")} placeholder="Filter by actor or action…" value={q} onChange={(e) => setQ(e.target.value)} />}><Table head={["When", "Who", "Action", "Detail"]} empty={rows.length ? undefined : "Nothing matches."}>{rows.map((r) => <tr key={r.id}><td className={cx(tdCls, "whitespace-nowrap")}>{dayLabel(r.at)} {timeLabel(r.at)}</td><td className={tdCls}>{r.who}</td><td className={tdCls}>{r.action}</td><td className={cx(tdCls, "text-[#64748B]")}>{r.detail}</td></tr>)}</Table></Card>;
}
export function SettingsScreen({ d }: { d: Data<"settings"> }) {
  const { run, busy } = useRun();
  const [s, setS] = useState(d.s);
  const co = (k: keyof typeof s.company) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setS({ ...s, company: { ...s.company, [k]: e.target.value } });
  return <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); run(() => saveSettings(s)); }}>
    <Card title="Company details" sub="Printed on payslips and invoices" pad><Grid n={3}><Field label="Company name"><input className={inputCls} value={s.company.name} onChange={co("name")} required /></Field><Field label="GSTIN"><input className={inputCls} value={s.company.gstin} onChange={co("gstin")} /></Field><Field label="State" hint="Decides CGST+SGST or IGST on invoices"><input className={inputCls} value={s.company.state} onChange={co("state")} /></Field><Field label="Phone"><input className={inputCls} value={s.company.phone} onChange={co("phone")} /></Field><Field label="Email"><input className={inputCls} value={s.company.email} onChange={co("email")} /></Field><Field label="Bank details (on invoices)"><input className={inputCls} value={s.company.bank} onChange={co("bank")} /></Field></Grid><Field label="Address"><textarea className={cx(inputCls, "mt-3")} rows={2} value={s.company.address} onChange={co("address")} /></Field></Card>
    <Grid n={2}>
      <Card title="Workforce policy" pad>
        <label className="flex items-center gap-2 text-[13.5px] py-1"><input type="checkbox" checked={s.checkin} onChange={(e) => setS({ ...s, checkin: e.target.checked })} />Attendance check-in <span className="text-[#64748B] text-[12px]">· employees check in and out; missed working days count as loss of pay</span></label>
        <label className="flex items-start gap-2 text-[13.5px] py-1.5"><input type="checkbox" className="mt-1" checked={s.selfie} onChange={(e) => setS({ ...s, selfie: e.target.checked })} /><span>Selfie check-in <span className="text-[#64748B] text-[12px] block">A photo is needed to check in and out. Kept 30 days, sealed, visible only to the employee and HR. Nothing is analysed. Tell your team before you switch it on.</span></span></label>
        <label className="flex items-start gap-2 text-[13.5px] py-1.5"><input type="checkbox" className="mt-1" checked={s.idleMonitor} onChange={(e) => setS({ ...s, idleMonitor: e.target.checked })} /><span>Idle-time monitoring <span className="text-[#64748B] text-[12px] block">While checked in and not on a break, inactivity in the HRMS tab is recorded (after a “still working?” prompt). No keystrokes, screenshots or other apps. Kept 90 days. Tell your team before you switch it on.</span></span></label>
        {s.idleMonitor ? <Field label="Ask “still working?” after (minutes)"><input className={cx(inputCls, "!w-24")} inputMode="numeric" value={s.idleMinutes} onChange={(e) => setS({ ...s, idleMinutes: Number(e.target.value.replace(/\D/g, "")) })} /></Field> : null}
        <Field label="Late after (HH:MM, India time)"><input className={cx(inputCls, "!w-32 mt-1")} value={s.lateAfter} onChange={(e) => setS({ ...s, lateAfter: e.target.value })} pattern="([01]\d|2[0-3]):[0-5]\d" /></Field>
        <Field label="Professional tax a month (₹)"><input className={cx(inputCls, "!w-32 mt-2")} inputMode="numeric" value={s.ptax} onChange={(e) => setS({ ...s, ptax: Number(e.target.value.replace(/\D/g, "")) })} /></Field>
      </Card>
      <Card title="Leave policy · days a year" pad><Grid n={4}>{LEAVE_TYPES.map((t) => <Field key={t.id} label={t.label}><input className={inputCls} inputMode="numeric" value={s.leave[t.id]} onChange={(e) => setS({ ...s, leave: { ...s.leave, [t.id]: Number(e.target.value.replace(/\D/g, "")) } })} /></Field>)}</Grid></Card>
    </Grid>
    <div><button className={primaryCls} disabled={busy}>Save settings</button></div>
  </form>;
}
