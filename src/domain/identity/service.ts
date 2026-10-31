import "server-only";
import { randomBytes } from "node:crypto";
import { Prisma } from "@prisma/client";
import { db, type Tx } from "@/server/db";
import { writeAudit } from "@/server/audit";
import { hashPassword } from "@/server/auth";
import { fingerprint, seal } from "@/server/vault";
import { UserError } from "@/server/action";
import { DEFAULT_GRANTS, ROLE_NAMES } from "./permissions";
import { inviteContact, setupSchema, type SetupInput } from "./contracts";
import { deploymentMismatch } from "./deployment";
import { TRIAL_DAYS } from "@/domain/system/subscription";

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

export async function nextEmployeeNo(tx: Tx, tenantId: string) {
  const rows = await tx.user.findMany({ where: { tenantId, employeeNo: { not: null } }, select: { employeeNo: true } });
  const max = rows.reduce((m, r) => Math.max(m, Number(r.employeeNo!.replace(/\D/g, "")) || 0), 100);
  return "E-" + (max + 1);
}

/**
 * Creates the pharmacy, branches, counters, roles, owner and invites in one transaction.
 * First-run setup allows only one pharmacy per installation; `signup` (self-service sign-up on a
 * hosted multi-pharmacy server) allows more, as long as the code and the owner's sign-in are free.
 */
export async function createPharmacy(raw: SetupInput, opts: { signup?: boolean } = {}) {
  try {
    return await create(raw, opts);
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") throw new UserError("That pharmacy code is taken. Choose another.");
    throw e;
  }
}

async function create(raw: SetupInput, { signup = false }: { signup?: boolean }) {
  const input = setupSchema.parse(raw);
  const mismatch = deploymentMismatch(input.deployment, process.env.DATABASE_URL);
  if (mismatch) throw new UserError(mismatch);
  const invites = input.invites.map((i) => ({ ...i, c: inviteContact(i.contact) }));
  const bad = invites.find((i) => !i.c);
  if (bad) throw new UserError(`“${bad.contact}” is not a valid email or mobile number.`);
  const mgr = invites.find((i) => i.role === "Manager" && !i.c!.email);
  if (mgr) throw new UserError("Invite managers by email: they sign in with a password and an authenticator app.");
  const pwHash = await hashPassword(input.owner.password);
  const key = Buffer.from(input.backupKey, "base64url");

  return db.$transaction(async (tx) => {
    // Serialise pharmacy creation: first-run setup allows one pharmacy per installation.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('medoro:setup'))`;
    const p = input.pharmacy;
    if (!signup && (await tx.tenant.count()) > 0) throw new UserError("This installation is already set up. Sign in instead.");
    if (signup) {
      // Owners sign in by email or mobile across all pharmacies, so these must not belong to anyone else.
      if (await tx.tenant.findUnique({ where: { code: p.code }, select: { id: true } })) throw new UserError("That pharmacy code is taken. Choose another.");
      const taken = await tx.user.findFirst({ where: { OR: [{ email: input.owner.email }, { phone: input.owner.phone }] }, select: { email: true } });
      if (taken) throw new UserError(taken.email === input.owner.email ? "An account with this email already exists. Sign in instead." : "An account with this mobile number already exists. Sign in instead.");
    }

    const tenant = await tx.tenant.create({
      data: {
        code: p.code, name: p.name, gstin: p.gstin || null, phone: input.owner.phone,
        settings: {
          lang: p.lang, pharmacist: p.pharmacist, deployment: input.deployment,
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
    await tx.subscriptionMeta.create({ data: { tenantId: tenant.id, plan: input.branches.length > 1 ? "Multi-branch" : "Professional", addons: [], status: "trial", renewsAt: new Date(Date.now() + TRIAL_DAYS * 86400_000) } });
    await writeAudit(tx, { tenantId: tenant.id, userId: owner.id, userName: owner.name, action: "Pharmacy set up", entity: "tenant", entityId: tenant.id, detail: `${branches.length} branch(es) · ${created.length} invite(s) · ${input.deployment}${signup ? " · self sign-up" : ""}` });
    return { tenantCode: tenant.code, ownerId: owner.id, invites: created };
  });
}
