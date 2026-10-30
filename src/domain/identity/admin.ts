import "server-only";
import { z } from "zod";
import { db } from "@/server/db";
import { writeAudit } from "@/server/audit";
import { hashPassword } from "@/server/auth";
import { authorize, type Ctx } from "@/server/context";
import { UserError } from "@/server/action";
import { verifyChain } from "@/lib/audit-hash";
import { GSTIN_RE, inviteContact, passwordSchema, pinSchema, ROLE_OPTIONS } from "./contracts";
import { OWNER_ONLY_GRANTS, PERMS, PERM_LABEL, type Perm } from "./permissions";
import { branchCodes, newInviteCode, nextEmployeeNo } from "./service";

export async function listTeam(ctx: Ctx) {
  authorize(ctx, "users");
  const [users, invites, branches, seen] = await Promise.all([
    db.user.findMany({ where: { tenantId: ctx.tenantId, isSupport: false }, include: { role: true }, orderBy: [{ active: "desc" }, { name: "asc" }] }),
    db.invite.findMany({ where: { tenantId: ctx.tenantId, usedAt: null, expiresAt: { gt: new Date() } }, orderBy: { createdAt: "desc" } }),
    db.branch.findMany({ where: { tenantId: ctx.tenantId }, orderBy: { createdAt: "asc" } }),
    db.session.groupBy({ by: ["userId"], where: { user: { tenantId: ctx.tenantId } }, _max: { lastSeenAt: true } }),
  ]);
  const bn = (ids: string[]) => (ids.length ? ids.map((i) => branches.find((b) => b.id === i)?.name ?? "?").join(", ") : "All branches");
  return {
    users: users.map((u) => ({
      id: u.id, name: u.name, contact: u.email ?? u.phone ?? "", phone: u.phone, employeeNo: u.employeeNo, role: u.role.name, branchIds: u.branchIds, branch: bn(u.branchIds),
      mfa: u.mfaEnabled, mfaRequired: u.mfaRequired, active: u.active, rolePerms: u.role.permissions, grants: u.permGrants, revokes: u.permRevokes, lastSeen: seen.find((s) => s.userId === u.id)?._max.lastSeenAt?.toISOString() ?? null, isMe: u.id === ctx.userId,
    })),
    invites: invites.map((i) => ({ id: i.id, code: i.code, contact: i.contact, role: i.roleName, branch: branches.find((b) => b.id === i.branchId)?.name ?? "All branches", expiresAt: i.expiresAt.toISOString(), reset: !!i.userId })),
  };
}

export const inviteSchema = z.object({
  name: z.string().trim().min(2, "Enter the employee’s full name.").max(120),
  contact: z.string().trim().min(3, "Enter a mobile number or email."),
  role: z.enum(ROLE_OPTIONS),
  branchId: z.string().uuid().nullable(),
});

export async function inviteEmployee(ctx: Ctx, raw: z.input<typeof inviteSchema>) {
  authorize(ctx, "users");
  const i = inviteSchema.parse(raw);
  const c = inviteContact(i.contact);
  if (!c) throw new UserError("Enter a valid 10-digit mobile number or email.");
  if (i.role === "Manager" && !c.email) throw new UserError("Invite managers by email: they sign in with a password and an authenticator app.");
  return db.$transaction(async (tx) => {
    if (i.branchId && !(await tx.branch.findFirst({ where: { id: i.branchId, tenantId: ctx.tenantId } }))) throw new UserError("Branch not found.");
    if (await tx.user.findFirst({ where: { tenantId: ctx.tenantId, OR: [c.phone ? { phone: c.phone } : { email: c.email }] } })) throw new UserError("Someone on your team already uses this contact.");
    await tx.invite.updateMany({ where: { tenantId: ctx.tenantId, contact: c.phone ?? c.email!, usedAt: null }, data: { expiresAt: new Date() } });
    const inv = await tx.invite.create({ data: { tenantId: ctx.tenantId, code: newInviteCode(), name: i.name, contact: c.phone ?? c.email!, roleName: i.role, branchId: i.branchId, createdBy: ctx.userId, expiresAt: new Date(Date.now() + 48 * 3600_000) } });
    await writeAudit(tx, { tenantId: ctx.tenantId, userId: ctx.userId, userName: ctx.userName, action: "Employee invited", entity: "invite", entityId: inv.id, detail: `${i.name} · ${i.role}` });
    const t = await tx.tenant.findUniqueOrThrow({ where: { id: ctx.tenantId } });
    return { code: inv.code, tenantCode: t.code, name: i.name };
  });
}

/** A reset code lets the person set a new PIN (or password for managers) through the join screen. */
export async function issueReset(ctx: Ctx, userId: string) {
  authorize(ctx, "users");
  return db.$transaction(async (tx) => {
    const u = await tx.user.findFirst({ where: { id: userId, tenantId: ctx.tenantId }, include: { role: true } });
    if (!u) throw new UserError("User not found.");
    if (u.role.name === "Owner") throw new UserError("Owners reset their password from the sign-in screen recovery flow.");
    const contact = u.role.name === "Manager" ? u.email : u.phone ?? u.email;
    if (!contact) throw new UserError("This person has no contact on file.");
    const inv = await tx.invite.create({ data: { tenantId: ctx.tenantId, code: newInviteCode(), name: u.name, contact, roleName: u.role.name, branchId: u.branchIds[0] ?? null, createdBy: ctx.userId, expiresAt: new Date(Date.now() + 48 * 3600_000), userId: u.id } });
    await tx.user.update({ where: { id: u.id }, data: { tokenVersion: { increment: 1 } } });
    await writeAudit(tx, { tenantId: ctx.tenantId, userId: ctx.userId, userName: ctx.userName, action: u.role.name === "Manager" ? "Password reset issued" : "PIN reset issued", entity: "user", entityId: u.id, detail: `${u.name} · signed out everywhere` });
    const t = await tx.tenant.findUniqueOrThrow({ where: { id: ctx.tenantId } });
    return { code: inv.code, tenantCode: t.code, name: u.name };
  });
}

/** Clears another user's authenticator: they set up a new one at their next sign-in. */
export async function resetTwoStep(ctx: Ctx, userId: string) {
  authorize(ctx, "users");
  return db.$transaction(async (tx) => {
    const u = await tx.user.findFirst({ where: { id: userId, tenantId: ctx.tenantId, isSupport: false }, include: { role: true } });
    if (!u) throw new UserError("User not found.");
    if (u.id === ctx.userId) throw new UserError("You can’t reset your own two-step verification here. At sign-in, use a recovery code or “Lost your authenticator?”.");
    if (u.role.name === "Owner") throw new UserError("Only the owner can reset the owner’s two-step verification, with a recovery code or an email/SMS code at sign-in.");
    if (!u.mfaEnabled && !u.mfaSecret) throw new UserError(`${u.name} hasn’t set up two-step verification.`);
    await tx.user.update({ where: { id: u.id }, data: { mfaSecret: null, mfaEnabled: false, tokenVersion: { increment: 1 } } });
    await tx.recoveryCode.deleteMany({ where: { userId: u.id } });
    await writeAudit(tx, { tenantId: ctx.tenantId, userId: ctx.userId, userName: ctx.userName, action: "Two-step verification reset", entity: "user", entityId: u.id, detail: `${u.name} · sets up a new authenticator at next sign-in · signed out everywhere` });
    return u.name;
  });
}

/** Managers sign in with email + password; every other role uses employee ID + PIN at the counter. */
const usesPassword = (role: string) => role === "Manager";

export type MemberPatch = { role?: string; branchIds?: string[]; active?: boolean; pin?: string; password?: string };

export async function updateMember(ctx: Ctx, userId: string, patch: MemberPatch) {
  authorize(ctx, "users");
  // Hash outside the transaction: Argon2 is slow.
  const pwHash = patch.password ? await hashPassword(passwordSchema.parse(patch.password)) : null;
  const pinHash = patch.pin ? await hashPassword(pinSchema.parse(patch.pin)) : null;
  return db.$transaction(async (tx) => {
    const u = await tx.user.findFirst({ where: { id: userId, tenantId: ctx.tenantId }, include: { role: true } });
    if (!u) throw new UserError("User not found.");
    if (u.id === ctx.userId) throw new UserError("You can’t change your own role, branches or status.");
    if (u.role.name === "Owner") throw new UserError("The owner account can’t be changed here.");
    const data: Record<string, unknown> = {};
    const notes: string[] = [];
    if (patch.role && patch.role !== u.role.name) {
      if (!(ROLE_OPTIONS as readonly string[]).includes(patch.role)) throw new UserError("Unknown role.");
      if (patch.role === "Manager" && !u.email) throw new UserError("Managers need an email address to sign in with a password.");
      const r = await tx.role.findFirstOrThrow({ where: { tenantId: ctx.tenantId, name: patch.role } });
      data.roleId = r.id; data.mfaRequired = usesPassword(patch.role);
      // Switching between password and PIN sign-in needs the new credential now, or they'd be locked out.
      if (usesPassword(patch.role) !== usesPassword(u.role.name)) {
        if (usesPassword(patch.role)) {
          if (!pwHash) throw new UserError(`Set a password for ${u.name}: managers sign in with email and password.`);
          data.passwordHash = pwHash; data.pinHash = null;
        } else {
          if (!pinHash) throw new UserError(`Set a 4-digit PIN for ${u.name}: ${patch.role}s sign in with employee ID and PIN.`);
          data.pinHash = pinHash; data.passwordHash = null;
          if (!u.employeeNo) data.employeeNo = await nextEmployeeNo(tx, ctx.tenantId);
        }
        notes.push("sign-in credential set");
      }
      notes.push(`role ${u.role.name} → ${patch.role}`);
    }
    if (patch.branchIds) {
      const n = await tx.branch.count({ where: { tenantId: ctx.tenantId, id: { in: patch.branchIds } } });
      if (n !== patch.branchIds.length) throw new UserError("Unknown branch.");
      data.branchIds = patch.branchIds; notes.push("branches changed");
    }
    if (patch.active != null && patch.active !== u.active) { data.active = patch.active; notes.push(patch.active ? "reactivated" : "deactivated"); }
    if (!notes.length) return;
    data.tokenVersion = { increment: 1 }; // changes take effect immediately: existing sessions end
    await tx.user.update({ where: { id: u.id }, data });
    await writeAudit(tx, { tenantId: ctx.tenantId, userId: ctx.userId, userName: ctx.userName, action: "User updated", entity: "user", entityId: u.id, detail: `${u.name} · ${notes.join(", ")}` });
  });
}

/** Per-user override of one permission: "grant" adds it on top of the role, "revoke" withholds it, "role" follows the role. */
export async function setUserPermission(ctx: Ctx, userId: string, perm: Perm, state: "role" | "grant" | "revoke") {
  authorize(ctx, "users");
  if (ctx.realRole !== ctx.role) throw new UserError("Switch back from “View as” before changing permissions.");
  if (!(PERMS as readonly string[]).includes(perm) || !["role", "grant", "revoke"].includes(state)) throw new UserError("Unknown permission.");
  if (state === "grant" && OWNER_ONLY_GRANTS.includes(perm) && ctx.realRole !== "Owner") throw new UserError(`Only the owner can grant “${PERM_LABEL[perm]}”.`);
  return db.$transaction(async (tx) => {
    const u = await tx.user.findFirst({ where: { id: userId, tenantId: ctx.tenantId, isSupport: false }, include: { role: true } });
    if (!u) throw new UserError("User not found.");
    if (u.id === ctx.userId) throw new UserError("You can’t change your own permissions.");
    if (u.role.locked || u.role.name === "Owner") throw new UserError("Owner permissions are locked.");
    const grants = u.permGrants.filter((p) => p !== perm), revokes = u.permRevokes.filter((p) => p !== perm);
    if (state === "grant" && !u.role.permissions.includes(perm)) grants.push(perm);
    if (state === "revoke" && u.role.permissions.includes(perm)) revokes.push(perm);
    const was = u.permGrants.includes(perm) ? "granted" : u.permRevokes.includes(perm) ? "revoked" : "role";
    const now = grants.includes(perm) ? "granted" : revokes.includes(perm) ? "revoked" : "role";
    if (was === now) return now;
    await tx.user.update({ where: { id: u.id }, data: { permGrants: grants, permRevokes: revokes } });
    await writeAudit(tx, { tenantId: ctx.tenantId, userId: ctx.userId, userName: ctx.userName, action: now === "granted" ? "User permission granted" : now === "revoked" ? "User permission revoked" : "User permission reset to role", entity: "user", entityId: u.id,
      detail: `${u.name} · ${PERM_LABEL[perm]} · ${was} → ${now}`, before: { grants: u.permGrants, revokes: u.permRevokes }, after: { grants, revokes } });
    return now;
  });
}

export async function revokeInvite(ctx: Ctx, id: string) {
  authorize(ctx, "users");
  const r = await db.invite.updateMany({ where: { id, tenantId: ctx.tenantId, usedAt: null }, data: { expiresAt: new Date() } });
  if (!r.count) throw new UserError("Invite not found.");
  await writeAudit(db, { tenantId: ctx.tenantId, userId: ctx.userId, userName: ctx.userName, action: "Invite revoked", entity: "invite", entityId: id });
}

// ───────────── Roles ─────────────

export async function roleMatrix(ctx: Ctx) {
  const roles = await db.role.findMany({ where: { tenantId: ctx.tenantId, NOT: { name: "Medoro support (read-only)" } } });
  const order = ["Owner", "Manager", "Pharmacist", "Cashier", "Accountant", "Delivery"];
  return roles.sort((a, b) => order.indexOf(a.name) - order.indexOf(b.name)).map((r) => ({ id: r.id, name: r.name, locked: r.locked, perms: r.permissions }));
}

export async function togglePermission(ctx: Ctx, roleId: string, perm: Perm) {
  authorize(ctx, "users");
  if (ctx.realRole !== ctx.role) throw new UserError("Switch back from “View as” before changing permissions.");
  if (!(PERMS as readonly string[]).includes(perm)) throw new UserError("Unknown permission.");
  return db.$transaction(async (tx) => {
    const r = await tx.role.findFirst({ where: { id: roleId, tenantId: ctx.tenantId } });
    if (!r) throw new UserError("Role not found.");
    if (r.locked) throw new UserError("Owner permissions are locked.");
    const on = r.permissions.includes(perm);
    await tx.role.update({ where: { id: r.id }, data: { permissions: on ? r.permissions.filter((p) => p !== perm) : [...r.permissions, perm] } });
    await writeAudit(tx, { tenantId: ctx.tenantId, userId: ctx.userId, userName: ctx.userName, action: on ? "Permission revoked" : "Permission granted", entity: "role", entityId: r.id, detail: `${r.name} · ${perm}` });
    return !on;
  });
}

// ───────────── Branches & counters ─────────────

export async function listBranches(ctx: Ctx) {
  const [branches, counters, users, stock] = await Promise.all([
    db.branch.findMany({ where: { tenantId: ctx.tenantId }, orderBy: { createdAt: "asc" } }),
    db.counter.findMany({ where: { tenantId: ctx.tenantId, active: true } }),
    db.user.findMany({ where: { tenantId: ctx.tenantId, active: true, isSupport: false }, select: { branchIds: true } }),
    db.$queryRaw<{ branchId: string; v: bigint }[]>`SELECT "branchId", SUM("qtyAvailable" * "costPaise") v FROM "Batch" WHERE "tenantId" = ${ctx.tenantId} GROUP BY 1`,
  ]);
  return branches.map((b, i) => ({
    id: b.id, name: b.name, code: b.code, main: i === 0, address: b.address, gstin: b.gstin, dl: b.drugLicence, active: b.active,
    staff: users.filter((u) => !u.branchIds.length || u.branchIds.includes(b.id)).length,
    counters: counters.filter((c) => c.branchId === b.id).map((c) => ({ id: c.id, name: c.name })),
    stock: Number(stock.find((s) => s.branchId === b.id)?.v ?? 0),
  }));
}

export const branchSchema = z.object({
  name: z.string().trim().min(2, "Enter the branch name.").max(60),
  address: z.string().trim().max(200).default(""),
  gstin: z.string().trim().toUpperCase().refine((g) => !g || GSTIN_RE.test(g), "GSTIN format looks wrong.").default(""),
  dl: z.string().trim().max(60).default(""),
});

export async function saveBranch(ctx: Ctx, id: string | null, raw: z.input<typeof branchSchema>) {
  authorize(ctx, "users");
  const i = branchSchema.parse(raw);
  return db.$transaction(async (tx) => {
    if (await tx.branch.findFirst({ where: { tenantId: ctx.tenantId, name: { equals: i.name, mode: "insensitive" }, ...(id ? { NOT: { id } } : {}) } })) throw new UserError("A branch with this name exists.");
    const data = { name: i.name, address: i.address || null, gstin: i.gstin || null, drugLicence: i.dl || null };
    if (id) {
      const r = await tx.branch.updateMany({ where: { id, tenantId: ctx.tenantId }, data });
      if (!r.count) throw new UserError("Branch not found.");
    } else {
      const used = (await tx.branch.findMany({ where: { tenantId: ctx.tenantId }, select: { code: true } })).map((b) => b.code);
      let code = branchCodes([i.name])[0];
      for (let k = 2; used.includes(code); k++) code = code.slice(0, 2) + k;
      const b = await tx.branch.create({ data: { tenantId: ctx.tenantId, code, ...data } });
      await tx.counter.create({ data: { tenantId: ctx.tenantId, branchId: b.id, name: "Counter 1" } });
      id = b.id;
    }
    await writeAudit(tx, { tenantId: ctx.tenantId, userId: ctx.userId, userName: ctx.userName, action: "Branch saved", entity: "branch", entityId: id, detail: i.name });
    return id;
  });
}

export async function addCounter(ctx: Ctx, branchId: string) {
  authorize(ctx, "users");
  return db.$transaction(async (tx) => {
    const b = await tx.branch.findFirst({ where: { id: branchId, tenantId: ctx.tenantId } });
    if (!b) throw new UserError("Branch not found.");
    const n = await tx.counter.count({ where: { branchId } });
    const c = await tx.counter.create({ data: { tenantId: ctx.tenantId, branchId, name: `Counter ${n + 1}` } });
    await writeAudit(tx, { tenantId: ctx.tenantId, userId: ctx.userId, userName: ctx.userName, action: "Counter added", entity: "counter", entityId: c.id, detail: `${b.name} · ${c.name}` });
    return c.name;
  });
}

// ───────────── Transfers & audit ─────────────

export async function listTransfers(ctx: Ctx) {
  const ts = await db.transfer.findMany({ where: { tenantId: ctx.tenantId }, orderBy: { createdAt: "desc" }, take: 50 });
  const [batches, branches] = await Promise.all([
    db.batch.findMany({ where: { id: { in: ts.map((t) => t.batchId) } }, include: { medicine: { select: { name: true } } } }),
    db.branch.findMany({ where: { tenantId: ctx.tenantId }, select: { id: true, name: true } }),
  ]);
  const bn = (id: string) => branches.find((b) => b.id === id)?.name ?? "?";
  return ts.map((t) => { const b = batches.find((x) => x.id === t.batchId); return { id: t.id, no: t.no, from: bn(t.fromBranch), to: bn(t.toBranch), fromId: t.fromBranch, toId: t.toBranch, item: b ? `${b.medicine.name} · ${b.batchNo}` : "", qty: t.qty, status: t.status, createdAt: t.createdAt.toISOString() }; });
}

export async function auditTrail(ctx: Ctx, take = 200) {
  authorize(ctx, "users");
  const rows = await db.auditEvent.findMany({ where: { tenantId: ctx.tenantId }, orderBy: { id: "desc" }, take });
  return rows.map((a) => ({ id: String(a.id), at: a.at.toISOString(), who: a.userName ?? "System", action: a.action, detail: a.detail, ip: a.ip }));
}

/** Re-computes the whole hash chain. Returns the first broken row, if any. */
export async function verifyAudit(ctx: Ctx) {
  authorize(ctx, "users");
  const rows = await db.auditEvent.findMany({ where: { tenantId: ctx.tenantId }, orderBy: { id: "asc" } });
  const bad = verifyChain(rows.map((r) => ({ ...r, at: r.at.toISOString() })));
  return { count: rows.length, ok: bad === -1, brokenAt: bad === -1 ? null : String(rows[bad].id) };
}

