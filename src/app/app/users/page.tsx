import { redirect } from "next/navigation";
import { requireCtx, can } from "@/server/context";
import { auditTrail, listBranches, listTeam, listTransfers, roleMatrix } from "@/domain/identity/admin";
import { PERMS, PERM_LABEL } from "@/domain/identity/permissions";
import { db } from "@/server/db";
import { PageHead } from "@/components/page-head";
import { t } from "@/lib/i18n";
import { UsersView } from "./view";

export const metadata = { title: "Users & branches" };

export default async function Page({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const ctx = await requireCtx();
  if (!can(ctx, "users")) redirect("/app");
  const tab = (["users", "roles", "branches", "audit"].includes((await searchParams).tab ?? "") ? (await searchParams).tab : "users") as "users" | "roles" | "branches" | "audit";
  const [team, roles, branches, transfers, audit, tenant] = await Promise.all([
    listTeam(ctx), roleMatrix(ctx), listBranches(ctx), listTransfers(ctx), tab === "audit" ? auditTrail(ctx) : Promise.resolve([]), db.tenant.findUniqueOrThrow({ where: { id: ctx.tenantId } }),
  ]);
  return (
    <>
      <PageHead title={t(ctx.lang).users} sub="Roles, permissions, branches and audit trail" />
      <UsersView tab={tab} team={team} roles={roles} perms={PERMS.map((p) => ({ id: p, label: PERM_LABEL[p] }))} branches={branches} transfers={transfers} audit={audit}
        tenantCode={tenant.code} myBranches={ctx.branches.map((b) => b.id)} canAdjust={can(ctx, "adjust")} />
    </>
  );
}
