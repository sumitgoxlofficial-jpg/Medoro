import "server-only";
import { z } from "zod";
import { db } from "@/server/db";
import { UserError } from "@/server/action";
import type { Ctx } from "@/server/context";
import { zId } from "@/lib/id";
import { inviteContact } from "@/domain/identity/contracts";
import { newInviteCode } from "@/domain/identity/service";
import { seatsUsed } from "@/domain/identity/admin";
import { distAuthorize, distView } from "./context";
import { audit, distEnt, requireDistRoom } from "./common";
import { DIST_PERMS, DIST_ROLES, distPerms } from "./perms";
import { DIST_PLANS, DIST_FEATURES } from "./plans";
import { distSettingsOf } from "./settings-shape";
import { einvConfig } from "@/domain/gst/einvoice";

/** Roles that sign in with email + password + authenticator; the rest use employee ID + PIN on shared devices. */
const PASSWORD_ROLES = new Set(["Owner", "Manager", "Accountant"]);

export async function distTeam(ctx: Ctx) {
  distView(ctx, "users");
  const [users, invites, roles] = await Promise.all([
    db.user.findMany({ where: { tenantId: ctx.tenantId, isSupport: false }, include: { role: true }, orderBy: { createdAt: "asc" } }),
    db.invite.findMany({ where: { tenantId: ctx.tenantId, usedAt: null, expiresAt: { gt: new Date() } }, orderBy: { createdAt: "desc" } }),
    db.role.findMany({ where: { tenantId: ctx.tenantId } }),
  ]);
  return {
    users: users.map((u) => ({ id: u.id, name: u.name, email: u.email, phone: u.phone, employeeNo: u.employeeNo, role: u.role.name, active: u.active, lastLoginAt: u.lastLoginAt, mfa: u.mfaEnabled, perms: distPerms(u.role.permissions, u.permGrants, u.permRevokes) })),
    invites,
    roles: roles.filter((r) => (DIST_ROLES as readonly string[]).includes(r.name)).sort((a, b) => DIST_ROLES.indexOf(a.name as never) - DIST_ROLES.indexOf(b.name as never)).map((r) => ({ id: r.id, name: r.name, locked: r.locked, perms: r.permissions })),
  };
}

export const distInviteSchema = z.object({ name: z.string().trim().min(2, "Enter the person’s full name.").max(120), contact: z.string().trim().min(3, "Enter a mobile number or email."), role: z.enum(DIST_ROLES).refine((r) => r !== "Owner", "There is one owner."), branchId: z.string().default("") });

export async function inviteDistUser(ctx: Ctx, raw: z.input<typeof distInviteSchema>) {
  distAuthorize(ctx, "users");
  const i = distInviteSchema.parse(raw);
  const c = inviteContact(i.contact);
  if (!c) throw new UserError("Enter a valid 10-digit mobile number or email.");
  if (PASSWORD_ROLES.has(i.role) && !c.email) throw new UserError(`Invite ${i.role.toLowerCase()}s by email: they sign in with a password and an authenticator app.`);
  await requireDistRoom(ctx.tenantId, "users", await seatsUsed(ctx.tenantId));
  return db.$transaction(async (tx) => {
    if (i.branchId && !(await tx.branch.findFirst({ where: { id: i.branchId, tenantId: ctx.tenantId } }))) throw new UserError("Godown not found.");
    if (await tx.user.findFirst({ where: { tenantId: ctx.tenantId, OR: [c.phone ? { phone: c.phone } : { email: c.email }] } })) throw new UserError("Someone on your team already uses this contact.");
    await tx.invite.updateMany({ where: { tenantId: ctx.tenantId, contact: c.phone ?? c.email!, usedAt: null }, data: { expiresAt: new Date() } });
    const inv = await tx.invite.create({ data: { tenantId: ctx.tenantId, code: newInviteCode(), name: i.name, contact: c.phone ?? c.email!, roleName: i.role, branchId: i.branchId || null, createdBy: ctx.userId, expiresAt: new Date(Date.now() + 48 * 3600_000) } });
    await audit(tx, ctx, "User invited", "invite", inv.id, `${i.name} · ${i.role}`);
    return { code: inv.code };
  });
}

export async function updateDistMember(ctx: Ctx, userId: string, patch: { role?: string; active?: boolean }) {
  distAuthorize(ctx, "users");
  return db.$transaction(async (tx) => {
    const u = await tx.user.findFirst({ where: { id: userId, tenantId: ctx.tenantId }, include: { role: true } });
    if (!u) throw new UserError("User not found.");
    if (u.id === ctx.userId) throw new UserError("You can’t change your own role or status.");
    if (u.role.name === "Owner") throw new UserError("The owner account can’t be changed here.");
    const data: Record<string, unknown> = {};
    const notes: string[] = [];
    if (patch.role && patch.role !== u.role.name) {
      if (!(DIST_ROLES as readonly string[]).includes(patch.role) || patch.role === "Owner") throw new UserError("Unknown role.");
      if (PASSWORD_ROLES.has(patch.role) !== PASSWORD_ROLES.has(u.role.name)) throw new UserError("This change switches between password and PIN sign-in. Deactivate the user and send a new invite for the new role.");
      data.roleId = (await tx.role.findFirstOrThrow({ where: { tenantId: ctx.tenantId, name: patch.role } })).id;
      notes.push(`role ${u.role.name} → ${patch.role}`);
    }
    if (patch.active != null && patch.active !== u.active) {
      if (patch.active) await requireDistRoom(ctx.tenantId, "users", await seatsUsed(ctx.tenantId));
      data.active = patch.active; notes.push(patch.active ? "reactivated" : "deactivated");
    }
    if (!notes.length) return;
    data.tokenVersion = { increment: 1 };
    await tx.user.update({ where: { id: u.id }, data });
    await audit(tx, ctx, "User updated", "user", u.id, `${u.name} · ${notes.join(", ")}`);
  });
}

export async function toggleDistPermission(ctx: Ctx, roleId: string, perm: string) {
  distAuthorize(ctx, "users");
  if (!(DIST_PERMS as readonly string[]).includes(perm)) throw new UserError("Unknown permission.");
  return db.$transaction(async (tx) => {
    const r = await tx.role.findFirst({ where: { id: roleId, tenantId: ctx.tenantId } });
    if (!r) throw new UserError("Role not found.");
    if (r.locked || r.name === "Owner") throw new UserError("Owner permissions are locked.");
    if (ctx.realRole !== "Owner" && (r.name === ctx.realRole || perm === "users" || perm === "integrations")) throw new UserError("Only the owner can make this change.");
    const on = r.permissions.includes(perm);
    await tx.role.update({ where: { id: r.id }, data: { permissions: on ? r.permissions.filter((p) => p !== perm) : [...r.permissions, perm] } });
    await audit(tx, ctx, on ? "Permission revoked" : "Permission granted", "role", r.id, `${r.name} · ${perm}`);
    return !on;
  });
}

export const distSettingsSchema = z.object({
  minShelfDays: z.coerce.number().int().min(1).max(730), coverDays: z.coerce.number().int().min(1).max(120), safetyDays: z.coerce.number().int().min(0).max(60), creditMode: z.enum(["hold", "block"]),
  legalName: z.string().trim().max(160).default(""), gstin: z.string().trim().toUpperCase().default(""),
});

export async function saveDistSettings(ctx: Ctx, raw: z.input<typeof distSettingsSchema>) {
  distAuthorize(ctx, "users");
  const i = distSettingsSchema.parse(raw);
  return db.$transaction(async (tx) => {
    const t = await tx.tenant.findUniqueOrThrow({ where: { id: ctx.tenantId } });
    const s = distSettingsOf(t.settings);
    await tx.tenant.update({ where: { id: ctx.tenantId }, data: { legalName: i.legalName || null, settings: { ...(t.settings as object), dist: { ...s, minShelfDays: i.minShelfDays, coverDays: i.coverDays, safetyDays: i.safetyDays, creditMode: i.creditMode } } } });
    await audit(tx, ctx, "Distribution settings changed", "settings", "dist", `min shelf ${i.minShelfDays}d · cover ${i.coverDays}d · safety ${i.safetyDays}d · credit ${i.creditMode}`);
  });
}

/** Integration status as it really is: configured, simulated or unavailable. Never claims a connection it doesn't have. */
export function integrationStatus() {
  const einv = (() => { try { return einvConfig(); } catch { return null; } })();
  return [
    { name: "E-invoice (IRN) & e-way bill", status: einv ? "configured" : "not configured", detail: einv ? `Using ${einv.provider === "gsp-http" ? "your GSP" : einv.provider === "nic-sandbox" ? "the NIC sandbox (test only)" : "NIC IRP"} credentials from the environment. Turn it on under GST settings.` : "Needs your own NIC IRP or GSP API credentials (EINVOICE_* variables). Until then invoices print without an IRN and e-way bills are made on the portal." },
    { name: "GSTR-1 / GSTR-3B", status: "available", detail: "JSON for the GSTN offline tool is generated here. Filing on the GST portal is done by you or your CA; there is no direct GSTN filing API connection." },
    { name: "GSTIN validation", status: "available (offline)", detail: "Checksum and state-code check only. Live taxpayer lookup needs a GSP account and is not connected." },
    { name: "Drug licence validation", status: "manual", detail: "Format and validity-date checks only; no state drug-controller registry offers a public API. Verify licence copies before giving credit (KYC button)." },
    { name: "Bank feeds", status: "statement import", detail: "CSV / Excel statement import with auto-matching. Direct bank APIs and Account Aggregator need partner onboarding and are not connected." },
    { name: "WhatsApp / SMS to chemists", status: process.env.WA_APP_ID ? "configured (pharmacy module)" : "not configured", detail: "Order and invoice notifications to chemists are not sent from Distribution yet." },
    { name: "Encrypted backups", status: "available", detail: "Uses the shared Medoro backup system (AES-256-GCM with the recovery-kit key) for the whole database." },
  ];
}

export async function planView(ctx: Ctx) {
  distView(ctx, "users");
  const [ent, meta, godowns, users, chemists] = await Promise.all([
    distEnt(ctx.tenantId), db.subscriptionMeta.findUnique({ where: { tenantId: ctx.tenantId } }),
    db.branch.count({ where: { tenantId: ctx.tenantId, active: true } }), seatsUsed(ctx.tenantId), db.distChemist.count({ where: { tenantId: ctx.tenantId } }),
  ]);
  return { ent, meta, used: { godowns, users, chemists }, plans: DIST_PLANS, features: DIST_FEATURES };
}

export const zUserId = zId;
