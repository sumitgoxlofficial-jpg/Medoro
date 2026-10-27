import "server-only";
import { randomBytes } from "node:crypto";
import { db, type Tx } from "@/server/db";
import { writeAudit } from "@/server/audit";
import { hashPassword } from "@/server/auth";
import { fingerprint, seal } from "@/server/vault";
import { UserError } from "@/server/action";
import { DEFAULT_GRANTS, ROLE_NAMES } from "./permissions";
import { inviteContact, setupSchema, type SetupInput } from "./contracts";

export const isSetupDone = async () => (await db.tenant.count()) > 0;

const INVITE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
export function newInviteCode() {
  const b = randomBytes(6);
  const s = Array.from(b, (x) => INVITE_ALPHABET[x % INVITE_ALPHABET.length]).join("");
  return s.slice(0, 4) + "-" + s.slice(4, 6);
}

export function branchCodes(names: string[]) {
  const used = new Set<string>();
  return names.map((n) => {
    const letters = n.toUpperCase().replace(/[^A-Z]/g, "") || "BR";
    let code = letters.slice(0, 3).padEnd(3, "X");
    for (let i = 2; used.has(code); i++) code = letters.slice(0, 2).padEnd(2, "X") + i;
    used.add(code);
    return code;
  });
}

export const invoicePrefix = (name: string) =>
  name.split(/\s+/).filter((w) => /^[A-Za-z]/.test(w)).slice(0, 3).map((w) => w[0].toUpperCase()).join("") || "INV";

export async function nextEmployeeNo(tx: Tx, tenantId: string) {
  const rows = await tx.user.findMany({ where: { tenantId, employeeNo: { not: null } }, select: { employeeNo: true } });
  const max = rows.reduce((m, r) => Math.max(m, Number(r.employeeNo!.replace(/\D/g, "")) || 0), 100);
  return "E-" + (max + 1);
}

/** First-run setup. Creates the pharmacy, branches, counters, roles, owner and invites in one transaction. */
export async function createPharmacy(raw: SetupInput) {
  const input = setupSchema.parse(raw);
  const invites = input.invites.map((i) => ({ ...i, c: inviteContact(i.contact) }));
  const bad = invites.find((i) => !i.c);
  if (bad) throw new UserError(`“${bad.contact}” is not a valid email or mobile number.`);
  const mgr = invites.find((i) => i.role === "Manager" && !i.c!.email);
  if (mgr) throw new UserError("Invite managers by email: they sign in with a password and an authenticator app.");
  const pwHash = await hashPassword(input.owner.password);
  const key = Buffer.from(input.backupKey, "base64url");

  return db.$transaction(async (tx) => {
    // Serialise first-run setup: only one pharmacy per installation.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('medoro:setup'))`;
    if ((await tx.tenant.count()) > 0) throw new UserError("This installation is already set up. Sign in instead.");

    const p = input.pharmacy;
    const tenant = await tx.tenant.create({
      data: {
        code: p.code, name: p.name, gstin: p.gstin || null, phone: input.owner.phone,
        settings: {
          invoicePrefix: invoicePrefix(p.name), lang: p.lang, pharmacist: p.pharmacist, deployment: input.deployment,
          policy: { cover: 21, safety: 2 }, anomaly: { disc: 5, refunds: 2, cash: 200 },
          privacy: { strict: true, remoteAi: false, telemetry: false, crash: false, retentionYears: 8 },
          crm: { refill: false, loyalty: false, feedback: false }, wa: { auto: false, pdf: true },
          backup: { schedule: "02:30", retention: 30, keyFingerprint: fingerprint(key) },
        },
      },
    });
    const codes = branchCodes(input.branches.map((b) => b.name));
    const branches = [];
    for (const [i, b] of input.branches.entries()) {
      const br = await tx.branch.create({ data: { tenantId: tenant.id, name: b.name, code: codes[i], address: i === 0 ? p.address || null : null, gstin: p.gstin || null, drugLicence: i === 0 ? p.dl : null } });
      for (let c = 1; c <= b.counters; c++) await tx.counter.create({ data: { tenantId: tenant.id, branchId: br.id, name: `Counter ${c}` } });
      branches.push(br);
    }
    const roles: Record<string, string> = {};
    for (const name of ROLE_NAMES) {
      const r = await tx.role.create({ data: { tenantId: tenant.id, name, permissions: DEFAULT_GRANTS[name], locked: name === "Owner" } });
      roles[name] = r.id;
    }
    const owner = await tx.user.create({
      data: {
        tenantId: tenant.id, name: input.owner.name, email: input.owner.email, phone: input.owner.phone, passwordHash: pwHash,
        roleId: roles.Owner, branchIds: [], mfaRequired: true, employeeNo: "E-101",
      },
    });
    await tx.integration.create({ data: { tenantId: tenant.id, kind: "backup_key", config: { fingerprint: fingerprint(key) }, encryptedSecret: new Uint8Array(seal(key)), connectedAt: new Date() } });

    const created = [];
    for (const i of invites) {
      const br = i.branch ? branches.find((b) => b.name === i.branch) : branches[0];
      const inv = await tx.invite.create({
        data: { tenantId: tenant.id, code: newInviteCode(), contact: i.c!.phone ?? i.c!.email!, roleName: i.role, branchId: br?.id ?? null, createdBy: owner.id, expiresAt: new Date(Date.now() + 48 * 3600_000) },
      });
      created.push({ contact: inv.contact, role: inv.roleName, code: inv.code });
    }
    await tx.subscriptionMeta.create({ data: { tenantId: tenant.id, plan: input.branches.length > 1 ? "Multi-branch" : "Professional", addons: [], status: "trial", renewsAt: new Date(Date.now() + 14 * 86400_000) } });
    await writeAudit(tx, { tenantId: tenant.id, userId: owner.id, userName: owner.name, action: "Pharmacy set up", entity: "tenant", entityId: tenant.id, detail: `${branches.length} branch(es) · ${created.length} invite(s) · ${input.deployment}` });
    return { tenantCode: tenant.code, ownerId: owner.id, invites: created };
  });
}
