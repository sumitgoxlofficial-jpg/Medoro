import "server-only";
import { z } from "zod";
import { db } from "@/server/db";
import { nextSeq } from "@/server/sequence";
import { UserError } from "@/server/action";
import { rateLimit } from "@/server/rate-limit";
import { dateOnly, todayISO } from "@/lib/dates";
import { staffAudit } from "./auth";
import { MOBILE_RE, digits } from "./constants";

const CP = "_cp";
export const WEBSITE_SOURCE = "Website trial";

export const websiteLeadSchema = z.object({
  name: z.string().trim().min(2, "Enter your name.").max(80),
  pharmacy: z.string().trim().min(3, "Enter the pharmacy name.").max(120),
  phone: z.string().transform(digits).refine((p) => MOBILE_RE.test(p), "Enter a valid 10-digit mobile number."),
  city: z.string().trim().min(2, "Enter your city.").max(60),
  email: z.union([z.literal(""), z.string().trim().toLowerCase().email("Enter a valid email, or leave it blank.").max(120)]).default(""),
  website: z.string().max(200).default(""), // honeypot: people never see it, bots fill it in
});

/** Website sales go to the active salesperson with the fewest open leads (else a super admin). */
async function assignee() {
  const sales = await db.staffUser.findMany({ where: { role: "sales", status: "active" }, select: { id: true } });
  if (sales.length) {
    const open = await db.lead.groupBy({ by: ["staffId"], where: { staffId: { in: sales.map((s) => s.id) }, stage: { notIn: ["won", "lost"] } }, _count: true });
    const n = new Map(open.map((o) => [o.staffId, o._count]));
    return sales.sort((a, b) => (n.get(a.id) ?? 0) - (n.get(b.id) ?? 0))[0].id;
  }
  return (await db.staffUser.findFirst({ where: { role: "super_admin", status: "active" }, orderBy: { createdAt: "asc" }, select: { id: true } }))?.id ?? "";
}

/**
 * "Start free trial" on the website. Creates a lead in the staff console. The answer is the same whether
 * or not the number was already a lead, so the form can't be used to look people up.
 */
export async function websiteLead(raw: z.input<typeof websiteLeadSchema>, ip: string | null) {
  const i = websiteLeadSchema.parse(raw);
  if (i.website) return { ok: true };
  if (!(await rateLimit("lead-ip:" + (ip ?? "unknown"), ip ? 5 : 50, 3600_000)) || !(await rateLimit("lead-phone:" + i.phone, 3, 86400_000))) {
    throw new UserError("Too many requests. Please try again in an hour, or message us on WhatsApp.");
  }
  const dup = await db.lead.findUnique({ where: { phone: i.phone } });
  if (dup) {
    await db.leadLog.create({ data: { leadId: dup.id, staffId: dup.staffId, text: `Asked again from the website (${i.pharmacy}, ${i.city})` } });
    if (dup.stage === "lost") await db.lead.update({ where: { id: dup.id }, data: { stage: "new", lostReason: null, nextOn: dateOnly(todayISO()) } });
    return { ok: true };
  }
  const staffId = await assignee();
  const n = await db.$transaction((tx) => nextSeq(tx, CP, "LEAD"));
  const lead = await db.lead.create({ data: { code: `L-${n}`, name: i.pharmacy, owner: i.name, phone: i.phone, city: i.city, email: i.email, source: WEBSITE_SOURCE, product: "pro", stage: "new", nextOn: dateOnly(todayISO()), staffId } });
  await staffAudit({ id: null, name: "Website" }, "Lead created", `${lead.code} · ${i.pharmacy} (website)`);
  return { ok: true };
}
