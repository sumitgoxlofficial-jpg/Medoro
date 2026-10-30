import "server-only";
import { z } from "zod";
import type { DbOrTx, Tx } from "@/server/db";
import type { Ctx } from "@/server/context";
import { UserError } from "@/server/action";
import { isStrict } from "@/domain/system/strict";

import { CHANNELS, METHODS, PURPOSES, type Channel, type Purpose } from "./consent-labels";
export type { Channel, Purpose } from "./consent-labels";

/** Customer flag holding the current state of each consent. Transactional WhatsApp is the existing waOptIn. */
export const CONSENT_FIELD = {
  transactional: { whatsapp: "waOptIn", sms: "smsOptIn" },
  marketing: { whatsapp: "marketingWa", sms: "marketingSms" },
} as const satisfies Record<Purpose, Record<Channel, string>>;

type Flags = { waOptIn: boolean; smsOptIn: boolean; marketingWa: boolean; marketingSms: boolean };
type ConsentCustomer = Partial<Flags> & { phone?: string | null; erasedAt?: Date | null; optInMethod?: string | null };

/**
 * Whether a message for `purpose` may go to this customer on `channel`. Marketing is separate from transactional consent,
 * and a STOP reply on WhatsApp (recorded as "Opted out…") also stops WhatsApp marketing.
 */
export function hasConsent(c: ConsentCustomer | null | undefined, purpose: Purpose, channel: Channel) {
  if (!c || !c.phone || c.erasedAt) return false;
  if (!c[CONSENT_FIELD[purpose][channel]]) return false;
  if (purpose === "marketing" && channel === "whatsapp" && !c.waOptIn && c.optInMethod?.startsWith("Opted out")) return false;
  return true;
}

/** Prisma `where` for customers who may receive `purpose` messages on `channel` (same rule as hasConsent). */
export function consentWhere(purpose: Purpose, channel: Channel) {
  const base = { erasedAt: null, phone: { not: null }, [CONSENT_FIELD[purpose][channel]]: true };
  return purpose === "marketing" && channel === "whatsapp" ? { ...base, NOT: { waOptIn: false, optInMethod: { startsWith: "Opted out" } } } : base;
}

/**
 * A STOP reply withdraws every consent on that channel, transactional and marketing, for the number, with one
 * ConsentRecord per consent withdrawn (method "reply"). `tenantId` null: every pharmacy on this server (they share
 * one SMS sender). Returns the customers that had a consent to withdraw.
 */
export async function withdrawByReply(q: DbOrTx, o: { tenantId: string | null; phone: string; channel: Channel; word: string }) {
  const field = (purpose: Purpose) => CONSENT_FIELD[purpose][o.channel];
  const hits = await q.customer.findMany({ where: { ...(o.tenantId ? { tenantId: o.tenantId } : {}), phone: o.phone, OR: PURPOSES.map((p) => ({ [field(p)]: true })) } });
  const how = `Opted out by replying ${o.word} ${o.channel === "sms" ? "by SMS" : "on WhatsApp"}`, now = new Date();
  for (const c of hits) {
    await q.customer.update({ where: { id: c.id }, data: o.channel === "sms" ? { smsOptIn: false, marketingSms: false, smsOptInAt: now, smsOptInMethod: how } : { waOptIn: false, marketingWa: false, optInAt: now, optInMethod: how } });
    for (const purpose of PURPOSES) {
      if (c[field(purpose)]) await q.consentRecord.create({ data: { tenantId: c.tenantId, customerId: c.id, purpose, channel: o.channel, granted: false, method: "reply", source: o.channel } });
    }
  }
  return hits;
}

/** Optional consent fields on customer forms. `waOptIn` keeps its place in the customer schema. */
export const consentSchema = z.object({
  smsOptIn: z.boolean().default(false),
  marketingWa: z.boolean().default(false),
  marketingSms: z.boolean().default(false),
  consentMethod: z.enum(METHODS).default("counter"),
});
export type ConsentInput = z.input<typeof consentSchema>;

/**
 * Sets a customer's consent flags and appends one ConsentRecord per change (with purpose, channel, method, source, user, time).
 * `before` is null for a new customer. Returns the changes as short labels for the audit line.
 */
export async function applyConsents(tx: Tx, ctx: Pick<Ctx, "tenantId" | "userId" | "userName">, customer: { id: string; phone: string | null } & Flags, before: (Flags & { phone: string | null }) | null, raw: ConsentInput & { waOptIn?: boolean }, source: string) {
  const prevPhone = before?.phone ?? null;
  const i = consentSchema.parse(raw);
  const want: Flags = { waOptIn: raw.waOptIn ?? customer.waOptIn, smsOptIn: i.smsOptIn, marketingWa: i.marketingWa, marketingSms: i.marketingSms };
  if (!customer.phone && Object.values(want).some(Boolean)) throw new UserError("Consent to messages needs a mobile number.");
  const newNumber = !!customer.phone && !prevPhone;
  const prev: Flags = before ?? { waOptIn: false, smsOptIn: false, marketingWa: false, marketingSms: false };
  const changes: string[] = [];
  for (const purpose of PURPOSES) for (const channel of CHANNELS) {
    const f = CONSENT_FIELD[purpose][channel];
    if (want[f] === prev[f]) continue;
    await tx.consentRecord.create({ data: { tenantId: ctx.tenantId, customerId: customer.id, purpose, channel, granted: want[f], method: i.consentMethod, source, userId: ctx.userId, userName: ctx.userName } });
    changes.push(`${want[f] ? "+" : "−"}${purpose} ${channel}`);
  }
  // Strict mode: a new number always gets a record, so the log shows "no consent" rather than nothing.
  if (newNumber && !changes.length && (await isStrict(ctx.tenantId))) {
    await tx.consentRecord.create({ data: { tenantId: ctx.tenantId, customerId: customer.id, purpose: "transactional", channel: "whatsapp", granted: false, method: i.consentMethod, source, userId: ctx.userId, userName: ctx.userName } });
    changes.push("no consent to messages");
  }
  if (want.smsOptIn !== customer.smsOptIn || want.marketingWa !== customer.marketingWa || want.marketingSms !== customer.marketingSms) {
    await tx.customer.update({ where: { id: customer.id }, data: { smsOptIn: want.smsOptIn, marketingWa: want.marketingWa, marketingSms: want.marketingSms } });
  }
  return changes;
}

export async function consentHistory(tx: Pick<Tx, "consentRecord">, tenantId: string, customerId: string) {
  const rows = await tx.consentRecord.findMany({ where: { tenantId, customerId }, orderBy: { at: "desc" }, take: 50 });
  return rows.map((r) => ({ purpose: r.purpose as Purpose, channel: r.channel as Channel, granted: r.granted, method: r.method, source: r.source, by: r.userName, at: r.at.toISOString() }));
}
