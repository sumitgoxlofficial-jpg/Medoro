import "server-only";
import { z } from "zod";
import { db } from "@/server/db";
import { UserError } from "@/server/action";
import { audit, need, notify, type Me } from "./auth";
import { POLICY_CATEGORIES } from "./constants";

// The company handbook: HR publishes policies; everyone reads them and acknowledges the current version of each mandatory one.

const activeStaff = () => db.staffUser.findMany({ where: { kind: "team", status: "active" }, select: { id: true, name: true, empNo: true } });

/** Everyone's view: live policies, newest first, with whether I have acknowledged the current version. */
export async function myPolicies(me: Me) {
  const [rows, acks] = await Promise.all([
    db.hrPolicy.findMany({ where: { archivedAt: null }, orderBy: [{ category: "asc" }, { title: "asc" }] }),
    db.hrPolicyAck.findMany({ where: { staffId: me.id } }),
  ]);
  const got = new Map<string, number>(); for (const a of acks) got.set(a.policyId, Math.max(got.get(a.policyId) ?? 0, a.version));
  return rows.map((p) => ({
    id: p.id, title: p.title, category: p.category, body: p.body, version: p.version, mandatory: p.mandatory, publishedAt: p.publishedAt.toISOString(), updatedAt: p.updatedAt.toISOString(),
    acked: (got.get(p.id) ?? 0) >= p.version, ackedBefore: (got.get(p.id) ?? 0) > 0 && (got.get(p.id) ?? 0) < p.version,
  }));
}
/** How many mandatory policies I still have to acknowledge (menu badge and home card). */
export async function policiesPending(me: Me) {
  return (await myPolicies(me)).filter((p) => p.mandatory && !p.acked).length;
}

export async function acknowledgePolicy(me: Me, id: string) {
  const p = await db.hrPolicy.findUnique({ where: { id } });
  if (!p || p.archivedAt) throw new UserError("This policy isn’t in the handbook any more.");
  await db.hrPolicyAck.upsert({ where: { policyId_staffId_version: { policyId: id, staffId: me.id, version: p.version } }, update: {}, create: { policyId: id, staffId: me.id, version: p.version } });
}

/** HR's view: every policy with who has and hasn't acknowledged the current version. */
export async function allPolicies(me: Me) {
  need(me, "employees");
  const [rows, staff, acks] = await Promise.all([db.hrPolicy.findMany({ orderBy: [{ archivedAt: "asc" }, { category: "asc" }, { title: "asc" }] }), activeStaff(), db.hrPolicyAck.findMany()]);
  return rows.map((p) => {
    const done = new Map(acks.filter((a) => a.policyId === p.id && a.version === p.version).map((a) => [a.staffId, a.ackedAt]));
    return {
      id: p.id, title: p.title, category: p.category, body: p.body, version: p.version, mandatory: p.mandatory, archived: !!p.archivedAt, publishedBy: p.publishedBy, publishedAt: p.publishedAt.toISOString(), updatedAt: p.updatedAt.toISOString(),
      acked: staff.filter((s) => done.has(s.id)).map((s) => ({ name: s.name, empNo: s.empNo, at: done.get(s.id)!.toISOString() })),
      pending: staff.filter((s) => !done.has(s.id)).map((s) => ({ name: s.name, empNo: s.empNo })),
    };
  });
}

const policySchema = z.object({
  title: z.string().trim().min(3, "Give the policy a title.").max(120),
  category: z.enum(POLICY_CATEGORIES),
  body: z.string().trim().min(20, "Write the policy text (at least a few lines).").max(20000),
  mandatory: z.boolean().default(true),
  /** Editing: true when the change is big enough that everyone must acknowledge it again. */
  reack: z.boolean().default(false),
});
export async function savePolicy(me: Me, id: string | null, raw: z.input<typeof policySchema>) {
  need(me, "employees");
  const i = policySchema.parse(raw);
  const everyone = (await activeStaff()).map((s) => s.id).filter((x) => x !== me.id);
  if (!id) {
    const p = await db.hrPolicy.create({ data: { title: i.title, category: i.category, body: i.body, mandatory: i.mandatory, publishedBy: me.name } });
    await notify(everyone, `New company policy: ${p.title}.${p.mandatory ? " Please read and acknowledge it." : ""}`, "policies");
    await audit(me, "Policy published", p.title);
    return p.id;
  }
  const old = await db.hrPolicy.findUnique({ where: { id } });
  if (!old || old.archivedAt) throw new UserError("Policy not found.");
  const bump = i.reack && old.mandatory && i.mandatory;
  await db.hrPolicy.update({ where: { id }, data: { title: i.title, category: i.category, body: i.body, mandatory: i.mandatory, version: bump ? old.version + 1 : old.version, publishedBy: me.name, publishedAt: bump ? new Date() : old.publishedAt } });
  if (bump) await notify(everyone, `The policy “${i.title}” was updated. Please read and acknowledge the new version.`, "policies");
  await audit(me, bump ? "Policy updated (acknowledge again)" : "Policy edited", `${i.title} · v${bump ? old.version + 1 : old.version}`);
  return id;
}

export async function archivePolicy(me: Me, id: string, archived: boolean) {
  need(me, "employees");
  const p = await db.hrPolicy.findUnique({ where: { id } });
  if (!p) throw new UserError("Policy not found.");
  await db.hrPolicy.update({ where: { id }, data: { archivedAt: archived ? new Date() : null } });
  await audit(me, archived ? "Policy archived" : "Policy restored", p.title);
}

/** HR nudges everyone who hasn't acknowledged the current version yet. */
export async function remindPolicy(me: Me, id: string) {
  need(me, "employees");
  const p = (await allPolicies(me)).find((x) => x.id === id);
  if (!p || p.archived || !p.mandatory) throw new UserError("Only live, mandatory policies need acknowledging.");
  const staff = await activeStaff(), names = new Set(p.pending.map((x) => x.empNo));
  const ids = staff.filter((s) => names.has(s.empNo) && s.id !== me.id).map((s) => s.id);
  if (!ids.length) throw new UserError("Everyone has acknowledged this policy.");
  await notify(ids, `Reminder: please read and acknowledge the policy “${p.title}”.`, "policies");
  return ids.length;
}
