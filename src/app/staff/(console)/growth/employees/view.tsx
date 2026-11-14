"use client";
import { useState } from "react";
import Link from "next/link";
import { GROWTH_ROLE_LABEL, INDIAN_STATES } from "@/staff/growth/constants";
import { addTerritory, decideEmployee, removeTerritory, saveTeam, setMember, setTarget } from "../../../growth-actions";
import { Empty, Panel, Pill, btn, btnPrimary, fieldCls, lbl, selSm, useRun } from "../../ui";

type T = { calls: number; connected: number; conversions: number } | null;
type P = { id: string; name: string; empNo: string; email: string; staffRole: string; status: string; growthRole: string | null; memberActive: boolean; teamId: string | null; team: string; territories: { id: string; state: string; district: string; pin: string }[]; targets: { daily: T; weekly: T }; activeLeads: number };

type Pending = { id: string; empNo: string; name: string; email: string; phone: string; team: string; googleSub: string | null; createdAt: string };

export function EmployeesView({ m, pending = [], admin }: { m: { teams: { id: string; name: string; managerId: string | null }[]; staff: P[] }; pending?: Pending[]; admin: boolean }) {
  const { run, busy } = useRun();
  const [team, setTeam] = useState({ name: "", managerId: "" });
  const managers = m.staff.filter((s) => s.growthRole === "manager");
  return (
    <>
      {admin ? <PendingSignups pending={pending} teams={m.teams} /> : null}
      <Panel title="Growth employees" sub="People come from the staff console’s Employees page (same sign-in). Here they get a Growth role, team, territory and targets.">
        {admin ? <div className="px-4 pt-3 text-[12.5px] text-muted">New person? Create or approve their profile in <Link className="text-teal" href="/staff/employees">Employees</Link> first.</div> : null}
        {m.staff.length ? m.staff.map((p) => <Person key={p.id} p={p} teams={m.teams} admin={admin} />) : <Empty>No staff yet.</Empty>}
      </Panel>
      {admin ? (
        <Panel title="Teams" sub="A marketing manager sees and assigns the leads of their team">
          {m.teams.map((t) => <div key={t.id} className="px-4 py-2 border-t border-[#F1F3F4] text-[13.5px]"><strong>{t.name}</strong> <span className="text-muted">· manager {m.staff.find((s) => s.id === t.managerId)?.name ?? "none"} · {m.staff.filter((s) => s.teamId === t.id).length} members</span></div>)}
          <form className="flex gap-2 p-4 flex-wrap" onSubmit={(e) => { e.preventDefault(); run(() => saveTeam({ name: team.name, managerId: team.managerId || null }), () => setTeam({ name: "", managerId: "" })); }}>
            <input className={selSm} placeholder="Team name, e.g. Pune West" value={team.name} onChange={(e) => setTeam({ ...team, name: e.target.value })} />
            <select className={selSm} value={team.managerId} onChange={(e) => setTeam({ ...team, managerId: e.target.value })}><option value="">Manager</option>{managers.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
            <button className={btn} disabled={busy || team.name.trim().length < 2}>Create team</button>
          </form>
        </Panel>
      ) : null}
    </>
  );
}

function Person({ p, teams, admin }: { p: P; teams: { id: string; name: string }[]; admin: boolean }) {
  const { run, busy } = useRun();
  const [open, setOpen] = useState(false);
  const [role, setRole] = useState(p.growthRole && p.growthRole !== "admin" ? p.growthRole : "sales");
  const [teamId, setTeamId] = useState(p.teamId ?? "");
  const [terr, setTerr] = useState({ state: "", district: "", pin: "" });
  const [tg, setTg] = useState({ period: "daily", calls: String(p.targets.daily?.calls ?? ""), connected: String(p.targets.daily?.connected ?? ""), conversions: String(p.targets.daily?.conversions ?? "") });
  const isAdmin = p.growthRole === "admin";
  return (
    <div className="border-t border-[#F1F3F4]">
      <div className="flex gap-2 items-center flex-wrap px-4 py-3 text-[13.5px]">
        <div className="flex-1 min-w-[220px]"><strong>{p.name}</strong> <span className="text-muted">· {p.empNo} · {p.email}</span>
          <div className="flex gap-1.5 mt-1 flex-wrap">{p.growthRole ? <Pill bg="#E1F1EF" fg="#0B5E5B">{GROWTH_ROLE_LABEL[p.growthRole as "sales"]}</Pill> : <Pill bg="#EEF0F2" fg="#3D454D">No Growth access</Pill>}{p.status !== "active" ? <Pill bg="#FBEAE9" fg="#C0362C">{p.status}</Pill> : null}{p.team ? <Pill bg="#EAF0FC" fg="#0B3A78">{p.team}</Pill> : null}<span className="text-muted text-[12px]">{p.activeLeads} active leads{p.targets.daily ? ` · ${p.targets.daily.calls} calls/day` : ""}{p.targets.weekly ? ` · ${p.targets.weekly.calls}/week` : ""}</span></div>
        </div>
        {!isAdmin ? <button className={btn} onClick={() => setOpen(!open)}>{open ? "Close" : "Manage"}</button> : <span className="text-muted text-[12px]">Super admin</span>}
      </div>
      {open ? (
        <div className="grid gap-4 px-4 pb-4 min-[1000px]:grid-cols-3">
          {admin ? (
            <div className="flex flex-col gap-2"><strong className="text-[13px]">Growth role</strong>
              <select className={fieldCls} value={role} onChange={(e) => setRole(e.target.value)}><option value="sales">Sales employee</option><option value="manager">Marketing manager</option><option value="analyst">Analyst (read-only analytics)</option></select>
              <select className={fieldCls} value={teamId} onChange={(e) => setTeamId(e.target.value)}><option value="">No team</option>{teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
              <div className="flex gap-2"><button className={btnPrimary} disabled={busy} onClick={() => run(() => setMember({ staffId: p.id, role: role as "sales", teamId: teamId || null, active: true }))}>Save role</button>
                {p.memberActive ? <button className={btn} disabled={busy} onClick={() => run(() => setMember({ staffId: p.id, role: role as "sales", teamId: teamId || null, active: false }))}>Remove access</button> : null}</div>
            </div>
          ) : null}
          <div className="flex flex-col gap-2"><strong className="text-[13px]">Territories</strong>
            {p.territories.map((t) => <div key={t.id} className="flex gap-2 items-center text-[13px]"><span className="flex-1">{t.state}{t.district ? ` / ${t.district}` : ""}{t.pin ? ` / ${t.pin}` : ""}</span><button className={btn} disabled={busy} onClick={() => run(() => removeTerritory(t.id))}>Remove</button></div>)}
            <select className={fieldCls} value={terr.state} onChange={(e) => setTerr({ ...terr, state: e.target.value })}><option value="">State</option>{INDIAN_STATES.map((s) => <option key={s}>{s}</option>)}</select>
            <div className="flex gap-2"><input className={fieldCls} placeholder="District (optional)" value={terr.district} onChange={(e) => setTerr({ ...terr, district: e.target.value })} /><input className={fieldCls} placeholder="PIN (optional)" maxLength={6} value={terr.pin} onChange={(e) => setTerr({ ...terr, pin: e.target.value })} /></div>
            <button className={btn + " self-start"} disabled={busy || !terr.state} onClick={() => run(() => addTerritory(p.id, terr as never), () => setTerr({ state: "", district: "", pin: "" }))}>Add territory</button>
          </div>
          <div className="flex flex-col gap-2"><strong className="text-[13px]">Calling target</strong>
            <select className={fieldCls} value={tg.period} onChange={(e) => setTg({ ...tg, period: e.target.value })}><option value="daily">Daily</option><option value="weekly">Weekly</option></select>
            <div className="grid grid-cols-3 gap-2">
              <label className={lbl}>Calls<input className={fieldCls} inputMode="numeric" value={tg.calls} onChange={(e) => setTg({ ...tg, calls: e.target.value })} /></label>
              <label className={lbl}>Connected<input className={fieldCls} inputMode="numeric" value={tg.connected} onChange={(e) => setTg({ ...tg, connected: e.target.value })} /></label>
              <label className={lbl}>Conversions<input className={fieldCls} inputMode="numeric" value={tg.conversions} onChange={(e) => setTg({ ...tg, conversions: e.target.value })} /></label>
            </div>
            <button className={btn + " self-start"} disabled={busy || !tg.calls} onClick={() => run(() => setTarget({ staffId: p.id, period: tg.period as "daily", calls: tg.calls, connected: tg.connected || 0, conversions: tg.conversions || 0 }))}>Save target (from today)</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function PendingSignups({ pending, teams }: { pending: Pending[]; teams: { id: string; name: string }[] }) {
  const { run, busy } = useRun();
  const [team, setTeam] = useState<Record<string, string>>({});
  return (
    <Panel title="Waiting for approval" sub="Sales profiles waiting for a super admin. Check they work for Medoro before approving: approval gives them the Sales employee Growth role. They sign in on the staff sign-in page (/staff/login) with the password HR issues.">
      {pending.length ? pending.map((p) => (
        <div key={p.id} className="flex gap-2 items-center flex-wrap px-4 py-3 border-t border-[#F1F3F4] text-[13.5px]">
          <div className="flex-1 min-w-[240px]"><strong>{p.name}</strong> <span className="text-muted">· {p.empNo}</span>
            <div className="text-muted text-[12.5px]">{p.email}{p.googleSub ? " (Google)" : ""} · {p.phone}{p.team ? ` · ${p.team}` : ""} · signed up {new Date(p.createdAt).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</div>
          </div>
          <select aria-label={`Team for ${p.name}`} className={selSm} value={team[p.id] ?? ""} onChange={(e) => setTeam({ ...team, [p.id]: e.target.value })}><option value="">No team</option>{teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
          <button className={btnPrimary} disabled={busy} onClick={() => run(() => decideEmployee(p.id, true, team[p.id] || null))}>Approve</button>
          <button className={btn} disabled={busy} onClick={() => { if (window.confirm(`Reject ${p.name}? They won’t be able to sign in.`)) run(() => decideEmployee(p.id, false, null)); }}>Reject</button>
        </div>
      )) : <Empty>No sign-ups waiting.</Empty>}
    </Panel>
  );
}
