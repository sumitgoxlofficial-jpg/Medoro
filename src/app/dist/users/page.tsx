import { requireDistCtx, distView } from "@/domain/distribution/context";
import { distTeam } from "@/domain/distribution/admin";
import { auditTrail } from "@/domain/identity/admin";
import { DIST_PERMS, DIST_PERM_LABEL, DIST_ROLES } from "@/domain/distribution/perms";
import { DataTable, dateIN, PageHead, Panel, Pill } from "../_ui/ui";
import { ActButton, ActForm, F, Grid, S } from "../_ui/forms";
import { inviteAction, memberAction, rolePermAction } from "../actions";

export const metadata = { title: "Users & roles" };

export default async function Page() {
  const ctx = await requireDistCtx();
  distView(ctx, "users");
  const [team, audit] = await Promise.all([distTeam(ctx), auditTrail(ctx, 80).catch(() => [])]);
  return (
    <>
      <PageHead title="Users, roles & permissions" sub="Owners, managers and accountants sign in with email, password and an authenticator app; warehouse, billing, sales and delivery staff with employee ID and PIN. Every change is in the audit trail." />
      <div className="grid gap-4 lg:grid-cols-[1fr_360px] mb-4">
        <Panel title="Team" pad={false}>
          <DataTable cols={[{ label: "Name" }, { label: "Sign-in" }, { label: "Role" }, { label: "Last sign-in" }, { label: "" }]}
            rows={team.users.map((u) => [<span key="n" className="font-medium">{u.name} {!u.active ? <Pill>Inactive</Pill> : null}</span>, <span key="s" className="text-[12px]">{u.email ?? u.phone}{u.employeeNo ? ` · ${u.employeeNo}` : ""}{u.mfa ? " · 2FA" : ""}</span>, u.role, u.lastLoginAt ? dateIN(u.lastLoginAt) : "—",
              u.role === "Owner" || u.id === ctx.userId ? "" : <span key="a" className="flex gap-1 justify-end">
                <ActButton size="sm" label={u.active ? "Deactivate" : "Reactivate"} confirm={u.active ? "Deactivate and sign out this user?" : undefined} action={async () => { "use server"; return memberAction(u.id, { active: !u.active }); }} />
                <ActButton size="sm" label="Change role" ask={`New role (${DIST_ROLES.filter((r) => r !== "Owner").join(", ")})`} action={async (r) => { "use server"; return memberAction(u.id, { role: r.trim() }); }} />
              </span>])} />
        </Panel>
        <Panel title="Invite a user">
          <ActForm action={inviteAction} submit="Create invite" resetOnOk>
            <F label="Full name" name="name" required />
            <F label="Mobile or email" name="contact" required />
            <Grid cols={2}>
              <S label="Role" name="role" options={DIST_ROLES.filter((r) => r !== "Owner").map((r) => ({ value: r, label: r }))} />
              <S label="Godown" name="branchId" options={[{ value: "", label: "All godowns" }, ...ctx.branches.map((b) => ({ value: b.id, label: b.name }))]} />
            </Grid>
          </ActForm>
          {team.invites.length ? <ul className="mt-3 text-[12.5px] list-none p-0 m-0">{team.invites.map((i) => <li key={i.id}>{i.name} · {i.roleName} · code <strong>{i.code}</strong></li>)}</ul> : null}
          <p className="text-[12px] text-muted mt-2">They join at Sign in → Staff login → “New employee? Create your account”, with your business code and this invite code.</p>
        </Panel>
      </div>
      <Panel title="Role permissions" sub="Click to grant or remove. Owner is locked." pad={false} className="mb-4">
        <div className="overflow-x-auto">
          <table className="w-full text-[12.5px] border-collapse">
            <thead><tr className="bg-subtle"><th className="text-left px-3 py-2">Permission</th>{team.roles.map((r) => <th key={r.id} className="px-2 py-2">{r.name}</th>)}</tr></thead>
            <tbody>{DIST_PERMS.map((p) => (
              <tr key={p} className="border-b border-line-soft"><td className="px-3 py-1.5">{DIST_PERM_LABEL[p]}</td>
                {team.roles.map((r) => <td key={r.id} className="text-center">{r.locked ? "✓" : <ActButton size="sm" variant={r.perms.includes(p) ? "primary" : "outline"} label={r.perms.includes(p) ? "✓" : "—"} action={async () => { "use server"; return rolePermAction(r.id, p); }} />}</td>)}
              </tr>
            ))}</tbody>
          </table>
        </div>
      </Panel>
      <Panel title="Audit trail (latest)" pad={false}>
        <DataTable dense cols={[{ label: "When" }, { label: "Who" }, { label: "Action" }, { label: "Detail" }]} rows={audit.map((a) => [dateIN(a.at), a.who, a.action, <span key="d" className="text-[12px]">{a.detail}</span>])} empty="Audit trail needs the Users permission." />
      </Panel>
    </>
  );
}
