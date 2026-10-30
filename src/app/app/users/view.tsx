"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { UserPlus, X, Copy, Store, ShieldCheck, Plus, Pencil, KeyRound } from "lucide-react";
import { Segmented } from "@/components/ui/segmented";
import { Button } from "@/components/ui/button";
import { Badge, type Tone } from "@/components/ui/badge";
import { Field, Input, Select } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { inrShort } from "@/lib/money";
import { dayMonth, hhmm } from "@/lib/dates";
import { ROLE_OPTIONS } from "@/domain/identity/contracts";
import type { auditTrail, listBranches, listTeam, listTransfers, MemberPatch, roleMatrix } from "@/domain/identity/admin";
import type { Perm } from "@/domain/identity/permissions";
import { branchAction, counterAction, inviteAction, maxDiscountAction, memberAction, permAction, resetAction, resetTwoStepAction, revokeInviteAction, transferAction, verifyAction } from "./actions";
import { UserPermsModal, overrideCount } from "./user-perms";

type Team = Awaited<ReturnType<typeof listTeam>>;
type Br = Awaited<ReturnType<typeof listBranches>>[number];
const ROLE_TONE: Record<string, Tone> = { Owner: "teal", Manager: "blue", Pharmacist: "green", Cashier: "gray", Accountant: "amber" };
const TR: Record<string, [string, Tone]> = { pending: ["Pending approval", "amber"], in_transit: ["In transit", "blue"], received: ["Received", "green"], rejected: ["Rejected", "gray"], cancelled: ["Cancelled", "gray"] };
const th = "text-left text-[12px] font-medium text-muted px-3.5 py-2.5 border-b border-[#E3E6E9] whitespace-nowrap";
const td = "px-3.5 py-2.5 border-b border-row";
const card = "bg-white border border-line rounded-xl shadow-[0_1px_2px_rgba(16,24,40,.04)]";
const when = (iso: string | null) => (iso ? `${dayMonth(new Date(iso))} ${hhmm(new Date(iso))}` : "Never");

function DiscountCeiling({ initial, isOwner }: { initial: number; isOwner: boolean }) {
  const toast = useToast();
  const [pending, start] = useTransition();
  const [v, setV] = useState(String(initial));
  const save = () => start(async () => {
    const r = await maxDiscountAction(Number(v));
    toast(r.ok ? r.message ?? "Saved." : r.error, r.ok ? "green" : "red");
  });
  return (
    <div className="flex items-end gap-3 flex-wrap mt-4 pt-3 border-t border-row">
      <Field label="Maximum discount on any bill, even with approval (%)">
        <Input type="number" min={0} max={90} step={1} value={v} disabled={!isOwner} onChange={(e) => setV(e.target.value)} className="w-[110px]" aria-label="Maximum discount percent" />
      </Field>
      {isOwner ? <Button variant="primary" disabled={pending || v === String(initial)} onClick={save}>Save</Button> : <span className="text-[12.5px] text-faint pb-2">Only the owner can change this.</span>}
    </div>
  );
}

export function UsersView({ tab, team, roles, perms, branches, transfers, audit, tenantCode, myBranches, canAdjust, maxDisc, isOwner }: {
  tab: "users" | "roles" | "branches" | "audit"; team: Team; roles: Awaited<ReturnType<typeof roleMatrix>>; perms: { id: Perm; label: string }[];
  branches: Br[]; transfers: Awaited<ReturnType<typeof listTransfers>>; audit: Awaited<ReturnType<typeof auditTrail>>; tenantCode: string; myBranches: string[]; canAdjust: boolean;
  maxDisc: number; isOwner: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [invite, setInvite] = useState(false);
  const [code, setCode] = useState<{ code: string; tenantCode: string; name: string; reset?: boolean } | null>(null);
  const [edit, setEdit] = useState<Team["users"][number] | null>(null);
  const [permUser, setPermUser] = useState<Team["users"][number] | null>(null);
  const [brEdit, setBrEdit] = useState<Br | "new" | null>(null);
  const [chain, setChain] = useState<string | null>(null);
  const res = (r: { ok: true; message?: string } | { ok: false; error: string }) => toast(r.ok ? r.message ?? "Saved." : r.error, r.ok ? "green" : "red");

  return (
    <div className="flex flex-col gap-3.5 max-w-[1400px]">
      <div className="flex items-center gap-3 flex-wrap">
        <Segmented value={tab} onChange={(v) => router.replace(v === "users" ? "/app/users" : `/app/users?tab=${v}`)} className="bg-[#EEF0F2]"
          options={[{ value: "users", label: "Users" }, { value: "roles", label: "Roles & permissions" }, { value: "branches", label: "Branches & transfers" }, { value: "audit", label: "Audit trail" }]} />
        <Button variant="primary" className="ml-auto" onClick={() => { setInvite(true); setCode(null); }}><UserPlus size={16} />Add employee</Button>
      </div>

      {code ? (
        <div className="bg-teal-soft border border-teal-line rounded-xl px-4 py-3 flex items-center gap-4 flex-wrap">
          <div className="flex flex-col gap-0.5">
            <span className="text-[12.5px] text-muted">{code.reset ? "Reset code" : "Invite"} for {code.name} · valid 48 hours</span>
            <span className="font-mono text-[22px] font-semibold tracking-wider">{code.code}</span>
            <span className="text-[12.5px] text-muted">Pharmacy code <span className="font-mono">{code.tenantCode}</span> · they open Sign in → Employee login → “New employee? Create your account”.</span>
          </div>
          <Button className="ml-auto" onClick={() => { navigator.clipboard.writeText(`Medoro: pharmacy code ${code.tenantCode}, ${code.reset ? "reset" : "invite"} code ${code.code}. Open Sign in → Employee login → New employee.`); toast("Copied.", "gray"); }}><Copy size={14} />Copy message</Button>
          <button onClick={() => setCode(null)} aria-label="Dismiss" className="text-faint cursor-pointer"><X size={18} /></button>
        </div>
      ) : null}

      {tab === "users" ? (
        <>
          <div className={card + " overflow-auto"}>
            <table className="w-full border-collapse min-w-[860px] text-[14px]">
              <thead><tr className="bg-subtle"><th className={th}>User</th><th className={th}>Role</th><th className={th}>Branch</th><th className={th}>MFA</th><th className={th}>Last active</th><th className={th} /></tr></thead>
              <tbody>
                {team.users.map((u) => (
                  <tr key={u.id} style={{ opacity: u.active ? 1 : 0.55 }}>
                    <td className={td}><div className="font-semibold">{u.name}{u.isMe ? <span className="text-faint font-normal"> (you)</span> : null}</div><div className="text-[12px] text-muted">{u.employeeNo ? <span className="font-mono">{u.employeeNo} · </span> : null}{u.contact}</div></td>
                    <td className={td}><Badge tone={ROLE_TONE[u.role] ?? "gray"}>{u.role}</Badge>{overrideCount(u) ? <Badge tone="blue" className="ml-1">{overrideCount(u)} custom</Badge> : null}{!u.active ? <Badge tone="red" className="ml-1">Deactivated</Badge> : null}</td>
                    <td className={td + " text-ink-2"}>{u.branch}</td>
                    <td className={td} style={{ color: u.mfa ? "#1E7F4F" : u.mfaRequired ? "#B3261E" : "#8A929A" }}>{u.mfa ? "On" : u.mfaRequired ? "Required, not set up" : "Off (PIN)"}</td>
                    <td className={td + " text-muted"}>{when(u.lastSeen)}</td>
                    <td className={td + " text-right whitespace-nowrap"}>
                      {!u.isMe && u.role !== "Owner" ? (
                        <div className="flex gap-1.5 justify-end">
                          <Button size="sm" variant="ghost" aria-label={`Edit ${u.name}`} onClick={() => setEdit(u)}><Pencil size={13} /></Button>
                          <Button size="sm" variant="ghost" aria-label={`Permissions for ${u.name}`} title="Permissions for this person" onClick={() => setPermUser(u)}><ShieldCheck size={13} /></Button>
                          <Button size="sm" disabled={pending} onClick={() => { if (confirm(`Issue a ${u.role === "Manager" ? "password" : "PIN"} reset for ${u.name}? They’ll be signed out everywhere.`)) start(async () => { const r = await resetAction(u.id); if (!r.ok) return toast(r.error, "red"); setCode({ ...r.data, reset: true }); }); }}><KeyRound size={13} />Reset</Button>
                          {u.mfa ? <Button size="sm" disabled={pending} title="Reset two-step verification" onClick={() => { if (confirm(`Reset two-step verification for ${u.name}? Their authenticator and recovery codes stop working, they’re signed out everywhere, and they set up a new authenticator at their next sign-in.`)) start(async () => { const r = await resetTwoStepAction(u.id); toast(r.ok ? `${r.data} will set up a new authenticator at next sign-in.` : r.error, r.ok ? "green" : "red"); }); }}><ShieldCheck size={13} />Reset 2-step</Button> : null}
                        </div>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {team.invites.length ? (
            <div className={card + " px-4 py-3"}>
              <div className="font-semibold text-[14.5px] mb-1">Open invites</div>
              {team.invites.map((i) => (
                <div key={i.id} className="flex items-center gap-3 py-1.5 border-b border-row last:border-0 text-[13.5px] flex-wrap">
                  <span className="font-mono font-semibold">{i.code}</span><span>{i.contact}</span><span className="text-muted">{i.reset ? "Reset" : i.role} · {i.branch} · expires {when(i.expiresAt)}</span>
                  <Button size="sm" variant="danger-outline" className="ml-auto" onClick={() => start(async () => res(await revokeInviteAction(i.id)))}>Revoke</Button>
                </div>
              ))}
            </div>
          ) : null}
        </>
      ) : null}

      {tab === "roles" ? (
        <div className={card + " p-4 overflow-auto"}>
          <div className="grid min-w-[700px]" style={{ gridTemplateColumns: `minmax(220px,1.4fr) repeat(${roles.length}, minmax(90px,1fr))` }}>
            <div className="text-[12px] text-muted font-medium py-2">Permission</div>
            {roles.map((r) => <div key={r.id} className="text-[12.5px] font-semibold text-center py-2">{r.name}</div>)}
            {perms.map((p) => (
              <div key={p.id} className="contents">
                <div className="text-[13.5px] py-2 border-t border-row">{p.label}</div>
                {roles.map((r) => {
                  const on = r.perms.includes(p.id);
                  return (
                    <div key={r.id} className="flex justify-center items-center border-t border-row">
                      <button disabled={r.locked || pending} aria-label={`${r.name} ${p.label}`} aria-pressed={on}
                        onClick={() => start(async () => { const x = await permAction(r.id, p.id); if (!x.ok) toast(x.error, "red"); else toast(`${x.data ? "Granted" : "Revoked"}: ${r.name} · ${p.label}`, "blue"); })}
                        className="size-6 rounded-md text-[13px] font-bold flex items-center justify-center disabled:cursor-not-allowed cursor-pointer"
                        style={{ background: on ? (r.locked ? "#CFE6E3" : "#0B5E5B") : "#fff", color: on ? (r.locked ? "#0B5E5B" : "#fff") : "#fff", border: on ? "0" : "1px solid #CDD2D7" }}>{on ? "✓" : ""}</button>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
          <div className="text-[12px] text-faint mt-3">Enforced on the server for every request. Use “View as” in the header to try a role. Owner permissions are locked.</div>
          <DiscountCeiling initial={maxDisc} isOwner={isOwner} />
        </div>
      ) : null}

      {tab === "branches" ? (
        <>
          <div className="grid gap-3 grid-cols-[repeat(auto-fill,minmax(280px,1fr))]">
            {branches.map((b) => (
              <div key={b.id} className={card + " p-4 flex flex-col gap-1.5"}>
                <div className="flex items-center gap-2"><Store size={16} className="text-teal" /><span className="font-semibold text-[15px]">{b.name}</span><Badge tone={b.main ? "teal" : "gray"}>{b.main ? "Main" : "Branch"} · {b.code}</Badge>
                  <Button size="sm" variant="ghost" className="ml-auto" aria-label={`Edit ${b.name}`} onClick={() => setBrEdit(b)}><Pencil size={13} /></Button></div>
                <div className="text-[13px] text-ink-2">{b.address || "No address"}</div>
                <div className="text-[13px] text-muted">{b.staff} staff · {b.counters.length} counter{b.counters.length === 1 ? "" : "s"} · {inrShort(b.stock)} stock at cost</div>
                <div className="text-[12.5px] text-faint">{b.gstin ? `GSTIN ${b.gstin}` : "No GSTIN"}{b.dl ? ` · DL ${b.dl}` : ""}</div>
                <div className="flex gap-1.5 flex-wrap mt-1">{b.counters.map((c) => <Badge key={c.id} tone="gray">{c.name}</Badge>)}<button onClick={() => start(async () => { const r = await counterAction(b.id); toast(r.ok ? `${r.data} added.` : r.error, r.ok ? "green" : "red"); })} className="text-teal text-[12.5px] font-semibold cursor-pointer flex items-center gap-0.5"><Plus size={13} />Counter</button></div>
              </div>
            ))}
            <button onClick={() => setBrEdit("new")} className="border-2 border-dashed border-input rounded-xl p-4 flex flex-col items-center justify-center gap-1 text-muted hover:border-teal hover:text-teal cursor-pointer min-h-[140px]"><Plus size={20} /><span className="text-[13.5px] font-semibold">Add branch</span></button>
          </div>
          <div className={card + " px-4 py-3"}>
            <div className="font-semibold text-[14.5px] mb-1">Stock transfers</div>
            {transfers.length ? transfers.map((x) => {
              const [label, tone] = TR[x.status] ?? [x.status, "gray"];
              return (
                <div key={x.id} className="grid grid-cols-[90px_minmax(150px,1fr)_minmax(0,1.6fr)_60px_auto_auto] gap-3 items-center py-2 border-b border-row last:border-0 text-[13.5px] max-md:grid-cols-2">
                  <span className="font-mono text-[12.5px]">{x.no}</span><span>{x.from} → {x.to}</span><span className="text-muted truncate">{x.item}</span><span className="tnum">× {x.qty}</span><Badge tone={tone}>{label}</Badge>
                  <span className="flex gap-1.5 justify-end">
                    {canAdjust && x.status === "pending" && myBranches.includes(x.fromId) ? <><Button size="sm" variant="primary" disabled={pending} onClick={() => start(async () => res(await transferAction(x.id, "approve")))}>Approve</Button><Button size="sm" disabled={pending} onClick={() => start(async () => res(await transferAction(x.id, "reject")))}>Reject</Button></> : null}
                    {canAdjust && x.status === "in_transit" && myBranches.includes(x.toId) ? <Button size="sm" variant="primary" disabled={pending} onClick={() => start(async () => res(await transferAction(x.id, "receive")))}>Mark received</Button> : null}
                    {canAdjust && x.status === "in_transit" && myBranches.includes(x.fromId) ? <Button size="sm" disabled={pending} onClick={() => start(async () => res(await transferAction(x.id, "cancel")))}>Cancel</Button> : null}
                  </span>
                </div>
              );
            }) : <div className="text-[13px] text-fainter">No transfers yet. Start one from Expiry prevention or a batch in Inventory.</div>}
          </div>
        </>
      ) : null}

      {tab === "audit" ? (
        <div className={card + " px-4 py-3 flex flex-col"}>
          <div className="flex items-center gap-3 mb-1 flex-wrap">
            <div className="font-semibold text-[14.5px]">Audit trail</div><span className="text-[12px] text-faint">Append-only and hash-chained on your server. Latest 200 events.</span>
            <Button size="sm" className="ml-auto" disabled={pending} onClick={() => start(async () => { const r = await verifyAction(); if (!r.ok) return toast(r.error, "red"); setChain(r.data.ok ? `Chain verified · ${r.data.count} events intact` : `Chain broken at event #${r.data.brokenAt}`); })}><ShieldCheck size={14} />Verify chain</Button>
          </div>
          {chain ? <div className="text-[13px] font-medium mb-2" style={{ color: chain.startsWith("Chain verified") ? "#1E7F4F" : "#B3261E" }}>{chain}</div> : null}
          {audit.map((a) => (
            <div key={a.id} className="grid grid-cols-[110px_minmax(0,1fr)_auto] gap-3 py-[7px] border-b border-row last:border-0 text-[13.5px] items-baseline">
              <span className="text-faint text-[12.5px] tnum">{when(a.at)}</span>
              <span><strong className="font-semibold">{a.action}</strong>{a.detail ? <span className="text-muted"> · {a.detail}</span> : null}</span>
              <span className="text-muted text-[12.5px] whitespace-nowrap">{a.who}{a.ip ? ` · ${a.ip}` : ""}</span>
            </div>
          ))}
        </div>
      ) : null}

      <InviteModal open={invite} onClose={() => setInvite(false)} branches={branches} onDone={(c) => { setInvite(false); setCode(c); }} tenantCode={tenantCode} />
      <MemberModal user={edit} branches={branches} onClose={() => setEdit(null)} />
      <UserPermsModal user={permUser} perms={perms} onClose={() => { setPermUser(null); router.refresh(); }} />
      <BranchModal edit={brEdit} onClose={() => setBrEdit(null)} />
    </div>
  );
}

function InviteModal({ open, onClose, branches, onDone, tenantCode }: { open: boolean; onClose: () => void; branches: Br[]; onDone: (c: { code: string; tenantCode: string; name: string }) => void; tenantCode: string }) {
  const [f, setF] = useState({ name: "", contact: "", role: "Cashier" as (typeof ROLE_OPTIONS)[number], branchId: branches[0]?.id ?? "" });
  const [err, setErr] = useState(""), [pending, start] = useTransition();
  return (
    <Modal open={open} onClose={onClose} title="Add employee" sub={`They join with pharmacy code ${tenantCode} and an invite code you share with them.`} width={520}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={pending} onClick={() => start(async () => { const r = await inviteAction({ ...f, branchId: f.branchId || null }); if (!r.ok) return setErr(r.error); setErr(""); setF({ ...f, name: "", contact: "" }); onDone(r.data); })}>Create & get invite code</Button></>}>
      <div className="grid grid-cols-2 gap-2.5 max-sm:grid-cols-1">
        <Field label="Full name"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoFocus /></Field>
        <Field label={f.role === "Manager" ? "Email" : "Mobile number or email"}><Input value={f.contact} onChange={(e) => setF({ ...f, contact: e.target.value })} /></Field>
        <Field label="Role"><Select value={f.role} onChange={(e) => setF({ ...f, role: e.target.value as typeof f.role })}>{ROLE_OPTIONS.map((r) => <option key={r}>{r}</option>)}</Select></Field>
        <Field label="Branch"><Select value={f.branchId} onChange={(e) => setF({ ...f, branchId: e.target.value })}><option value="">All branches</option>{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</Select></Field>
      </div>
      <div className="text-[12.5px] text-faint">{f.role === "Manager" ? "Managers set a password and an authenticator app." : "They sign in at the counter with an employee ID and a PIN they choose."}</div>
      {err ? <div role="alert" className="text-[13px] text-bad">{err}</div> : null}
    </Modal>
  );
}

function MemberModal({ user, branches, onClose }: { user: Team["users"][number] | null; branches: Br[]; onClose: () => void }) {
  const toast = useToast();
  const [role, setRole] = useState(""), [bids, setBids] = useState<string[]>([]), [secret, setSecret] = useState("");
  const [pending, start] = useTransition();
  const [lastId, setLastId] = useState<string | null>(null);
  if (user && user.id !== lastId) { setLastId(user.id); setRole(user.role); setBids(user.branchIds); setSecret(""); }
  if (!user) return null;
  // Moving between Manager (email + password) and a counter role (employee ID + PIN) needs the new credential.
  const needs = (role === "Manager") !== (user.role === "Manager") ? (role === "Manager" ? "password" : "pin") : null;
  const save = (patch: MemberPatch) => start(async () => { const r = await memberAction(user.id, patch); toast(r.ok ? r.message! : r.error, r.ok ? "green" : "red"); if (r.ok) onClose(); });
  return (
    <Modal open onClose={onClose} title={user.name} sub={`${user.employeeNo ?? ""} ${user.contact}`} width={460}
      footer={<><Button variant={user.active ? "danger-outline" : "outline"} className="mr-auto" disabled={pending} onClick={() => { if (confirm(user.active ? `Deactivate ${user.name}? They’ll be signed out and can’t sign in.` : `Reactivate ${user.name}?`)) save({ active: !user.active }); }}>{user.active ? "Deactivate" : "Reactivate"}</Button><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={pending} onClick={() => save({ role, branchIds: bids, ...(needs === "password" ? { password: secret } : needs === "pin" ? { pin: secret } : {}) })}>Save</Button></>}>
      <Field label="Role"><Select value={role} onChange={(e) => { setRole(e.target.value); setSecret(""); }}>{ROLE_OPTIONS.map((r) => <option key={r}>{r}</option>)}</Select></Field>
      {needs === "password" ? (
        <Field label="New password (min 10 characters)"><Input type="password" autoComplete="new-password" value={secret} onChange={(e) => setSecret(e.target.value)} /></Field>
      ) : needs === "pin" ? (
        <Field label="New 4-digit PIN"><Input inputMode="numeric" autoComplete="off" maxLength={4} value={secret} onChange={(e) => setSecret(e.target.value.replace(/\D/g, ""))} /></Field>
      ) : null}
      {needs ? <div className="text-[12px] text-faint">{needs === "password" ? "Managers sign in with their email, this password and an authenticator app. Share it with them privately." : `${role}s sign in at the counter with employee ID ${user.employeeNo ?? "(assigned on save)"} and this PIN. Share it with them privately.`}</div> : null}
      <div className="flex flex-col gap-1.5 text-[12.5px] text-muted font-medium">Branches
        <label className="flex gap-2 text-[13.5px] text-ink font-normal"><input type="checkbox" className="accent-teal" checked={!bids.length} onChange={(e) => setBids(e.target.checked ? [] : [branches[0].id])} />All branches</label>
        {bids.length ? branches.map((b) => <label key={b.id} className="flex gap-2 text-[13.5px] text-ink font-normal pl-5"><input type="checkbox" className="accent-teal" checked={bids.includes(b.id)} onChange={(e) => setBids(e.target.checked ? [...bids, b.id] : bids.filter((x) => x !== b.id).length ? bids.filter((x) => x !== b.id) : bids)} />{b.name}</label>) : null}
      </div>
      <div className="text-[12px] text-faint">Changes sign them out of open sessions so new permissions apply straight away.</div>
    </Modal>
  );
}

function BranchModal({ edit, onClose }: { edit: Br | "new" | null; onClose: () => void }) {
  const toast = useToast();
  const [f, setF] = useState({ name: "", address: "", gstin: "", dl: "" });
  const [err, setErr] = useState(""), [pending, start] = useTransition();
  const [key, setKey] = useState<string | null>(null);
  const k = edit === "new" ? "new" : edit?.id ?? null;
  if (k !== key) { setKey(k); setErr(""); setF(edit && edit !== "new" ? { name: edit.name, address: edit.address ?? "", gstin: edit.gstin ?? "", dl: edit.dl ?? "" } : { name: "", address: "", gstin: "", dl: "" }); }
  if (!edit) return null;
  return (
    <Modal open onClose={onClose} title={edit === "new" ? "Add branch" : `Edit ${edit.name}`} width={480}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={pending} onClick={() => start(async () => { const r = await branchAction(edit === "new" ? null : edit.id, f); if (!r.ok) return setErr(r.error); toast(r.message!, "green"); onClose(); })}>Save branch</Button></>}>
      <Field label="Name"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoFocus /></Field>
      <Field label="Address"><Input value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} /></Field>
      <div className="grid grid-cols-2 gap-2.5">
        <Field label="GSTIN"><Input value={f.gstin} onChange={(e) => setF({ ...f, gstin: e.target.value.toUpperCase() })} className="font-mono" maxLength={15} /></Field>
        <Field label="Drug licence"><Input value={f.dl} onChange={(e) => setF({ ...f, dl: e.target.value })} /></Field>
      </div>
      {err ? <div role="alert" className="text-[13px] text-bad">{err}</div> : null}
    </Modal>
  );
}
