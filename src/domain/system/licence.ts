import "server-only";
import { z } from "zod";
import { db } from "@/server/db";
import { seal, unseal } from "@/server/vault";
import { writeAudit } from "@/server/audit";
import { authorize, type Ctx } from "@/server/context";
import { UserError } from "@/server/action";
import { addDays, dateOnly, isoOf } from "@/lib/dates";
import { LICENCE_HEADER, SIGNATURE_HEADER, parseLicenceKey, payLinkBody, requestSignature, verifyDoc, type LicenceDoc, type SignedDoc } from "@/lib/licence";
import { grantSupport } from "@/domain/identity/support";
import { accessFor, licenceServer } from "./access";

/**
 * The pharmacy side of licensing. The installation registers with the licence server (Medoro's staff console,
 * LICENSE_SERVER_URL) once, then checks in hourly from the in-process scheduler, daily from a host cron, and when
 * Plan, Help or Privacy is opened. Each answer is a licence document signed with Medoro's Ed25519 key; it is
 * verified with LICENSE_PUBLIC_KEY before anything is stored. Check-ins carry only the app version, branch and
 * device counts, and the requests the pharmacy queued (support tickets, plan changes, payment claims).
 */

export const APP_VERSION = "0.1.0";
export type Inbox = Partial<Pick<LicenceDoc, "invoices" | "billing" | "tickets" | "remote">> & { customerCode?: string };

type Kind = "ticket" | "ticket_reply" | "addon_add" | "addon_remove" | "cancel" | "payment" | "remote_decision";

async function credentials(tenantId: string) {
  const m = await db.subscriptionMeta.findUnique({ where: { tenantId } });
  if (!m?.licenceId || !m.licenceToken) return null;
  return { licenceId: m.licenceId, token: unseal(Buffer.from(m.licenceToken, "base64")).toString("utf8") };
}

async function call<T>(path: string, body: unknown, cred: { licenceId: string; token: string } | null, timeoutMs: number): Promise<T> {
  const url = licenceServer();
  if (!url) throw new UserError("This installation isn’t connected to Medoro’s licence server (LICENSE_SERVER_URL is not set).");
  const text = JSON.stringify(body);
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (cred) { headers[LICENCE_HEADER] = cred.licenceId; headers[SIGNATURE_HEADER] = requestSignature(cred.token, text); }
  let res: Response;
  try {
    res = await fetch(url + path, { method: "POST", headers, body: text, signal: AbortSignal.timeout(timeoutMs), cache: "no-store" });
  } catch {
    throw new UserError(`Couldn’t reach Medoro’s licence server. Your last licence keeps applying; it will retry automatically.`);
  }
  const j = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!res.ok || !j) throw new UserError(j?.error ?? `Licence server answered ${res.status}.`);
  return j;
}

async function usage(tenantId: string) {
  const [branches, devices, tenant] = await Promise.all([
    db.branch.count({ where: { tenantId, active: true } }),
    db.counter.count({ where: { tenantId, active: true } }),
    db.tenant.findUniqueOrThrow({ where: { id: tenantId } }),
  ]);
  return { branches, devices, deployment: (tenant.settings as { deployment?: string }).deployment ?? "", appVersion: APP_VERSION, tenant };
}

/** First contact: the licence server starts the trial and hands back this installation's licence id and token. */
async function register(tenantId: string, timeoutMs: number) {
  const u = await usage(tenantId);
  const [owner, branch] = await Promise.all([
    db.user.findFirst({ where: { tenantId, isSupport: false, role: { name: "Owner" } }, orderBy: { createdAt: "asc" } }),
    db.branch.findFirst({ where: { tenantId }, orderBy: { createdAt: "asc" } }),
  ]);
  const phone = u.tenant.phone || owner?.phone || "";
  if (!phone) throw new UserError("Add the owner’s mobile number (Users) so Medoro can start your licence.");
  const r = await call<{ licenceId: string; token: string }>("/api/license/register", {
    pharmacy: u.tenant.name, owner: owner?.name ?? "", phone, email: owner?.email ?? "", city: branch?.address ?? "", gstin: u.tenant.gstin ?? "", drugLicence: branch?.drugLicence ?? "",
    setupAt: u.tenant.createdAt.toISOString(), branches: u.branches, devices: u.devices, deployment: u.deployment, appVersion: APP_VERSION,
  }, null, timeoutMs);
  await db.subscriptionMeta.update({ where: { tenantId }, data: { licenceId: r.licenceId, licenceToken: seal(r.token).toString("base64") } });
  return { licenceId: r.licenceId, token: r.token };
}

/** Verifies and stores a signed licence document; marks the requests it answered as sent. */
export async function applyLicence(tenantId: string, s: SignedDoc) {
  const pk = process.env.LICENSE_PUBLIC_KEY;
  if (!pk) throw new UserError("LICENSE_PUBLIC_KEY is not set, so the licence can’t be verified.");
  const d = verifyDoc(s, pk);
  if (!d) throw new UserError("The licence server’s answer failed signature verification. Nothing was changed.");
  const m = await db.subscriptionMeta.findUniqueOrThrow({ where: { tenantId } });
  if (d.licenceId !== m.licenceId) throw new UserError("That licence belongs to another installation.");
  if (m.issuedAt && new Date(d.issuedAt) < m.issuedAt) throw new UserError("That licence is older than the one already stored.");
  const inbox: Inbox = { customerCode: d.customerCode, invoices: d.invoices, billing: d.billing, tickets: d.tickets, remote: d.remote };
  const now = new Date();
  await db.$transaction([
    db.subscriptionMeta.update({ where: { tenantId }, data: {
      plan: d.planName, addons: d.addons, status: d.status, renewsAt: d.endsOn ? dateOnly(d.endsOn) : null, graceDays: d.graceDays,
      graceUntil: d.endsOn ? dateOnly(addDays(d.endsOn, d.status === "cancelled" ? 0 : d.graceDays)) : null,
      signedDoc: JSON.stringify(s), issuedAt: new Date(d.issuedAt), checkError: null, inbox,
    } }),
    ...d.processed.map((p) => db.licenceOutbox.updateMany({ where: { id: p.id, tenantId }, data: { sentAt: now, result: p } })),
  ]);
  return d;
}

/**
 * Checks in with the licence server. `minAgeMs` throttles: it is skipped when another check-in started more
 * recently. Never throws; failures are kept on SubscriptionMeta for the Plan screen.
 */
export async function checkIn(tenantId: string, opts: { minAgeMs?: number; timeoutMs?: number } = {}) {
  if (!licenceServer()) return { ok: false as const, skipped: true };
  const timeoutMs = opts.timeoutMs ?? 10_000;
  const now = new Date();
  const claimed = await db.subscriptionMeta.updateMany({
    where: { tenantId, ...(opts.minAgeMs ? { OR: [{ checkedAt: null }, { checkedAt: { lt: new Date(now.getTime() - opts.minAgeMs) } }] } : {}) },
    data: { checkedAt: now },
  });
  if (!claimed.count) return { ok: false as const, skipped: true };
  try {
    const cred = (await credentials(tenantId)) ?? (await register(tenantId, timeoutMs));
    const u = await usage(tenantId);
    const pending = await db.licenceOutbox.findMany({ where: { tenantId, sentAt: null }, orderBy: { createdAt: "asc" }, take: 50 });
    const s = await call<SignedDoc>("/api/license/checkin", {
      appVersion: u.appVersion, branches: u.branches, devices: u.devices, deployment: u.deployment,
      requests: pending.map((r) => ({ id: r.id, kind: r.kind, payload: r.payload, createdBy: r.createdBy })),
    }, cred, timeoutMs);
    await applyLicence(tenantId, s);
    return { ok: true as const };
  } catch (e) {
    const error = e instanceof UserError ? e.message : "Licence check-in failed.";
    if (!(e instanceof UserError)) console.error("[licence]", e);
    await db.subscriptionMeta.updateMany({ where: { tenantId }, data: { checkError: error } });
    return { ok: false as const, error };
  }
}

/** From the scheduler: hourly (in-process) or once a day (host cron). */
export async function licenceTick() {
  if (!licenceServer()) return;
  for (const t of await db.tenant.findMany({ select: { id: true } })) await checkIn(t.id, { minAgeMs: 55 * 60_000 });
}

async function queue(ctx: Ctx, kind: Kind, payload: Record<string, unknown>) {
  if (!licenceServer()) throw new UserError("This installation isn’t connected to Medoro’s licence server, so the request can’t be sent. Contact Medoro support directly.");
  const r = await db.licenceOutbox.create({ data: { tenantId: ctx.tenantId, kind, payload: payload as object, createdBy: ctx.userName } });
  await checkIn(ctx.tenantId, { timeoutMs: 8000 });
  const after = await db.licenceOutbox.findUniqueOrThrow({ where: { id: r.id } });
  const result = after.result as { ok?: boolean; error?: string; ref?: string } | null;
  if (result && result.ok === false) throw new UserError(result.error ?? "Medoro couldn’t accept that request.");
  return { id: r.id, sent: !!after.sentAt, ref: result?.ref ?? null };
}

// ── Plan screen (owner).
export async function connectLicenceKey(ctx: Ctx, key: string) {
  authorize(ctx, "users");
  const k = parseLicenceKey(key);
  if (!k) throw new UserError("That doesn’t look like a Medoro licence key (it starts with MEDORO-).");
  const m = await db.subscriptionMeta.findUnique({ where: { tenantId: ctx.tenantId } });
  await db.subscriptionMeta.update({ where: { tenantId: ctx.tenantId }, data: { licenceId: k.licenceId, licenceToken: seal(k.token).toString("base64"), ...(m?.licenceId !== k.licenceId ? { issuedAt: null, signedDoc: null } : {}) } });
  await writeAudit(db, { tenantId: ctx.tenantId, userId: ctx.userId, userName: ctx.userName, action: "Licence key entered", entity: "subscription", detail: `Licence ${k.licenceId.slice(0, 8)}…` });
  const r = await checkIn(ctx.tenantId);
  if (!r.ok) throw new UserError(("error" in r && r.error) || "Saved, but the licence server couldn’t be reached yet.");
}

export async function requestAddon(ctx: Ctx, add: boolean) {
  authorize(ctx, "users");
  const r = await queue(ctx, add ? "addon_add" : "addon_remove", { addon: "ai" });
  await writeAudit(db, { tenantId: ctx.tenantId, userId: ctx.userId, userName: ctx.userName, action: add ? "AI add-on requested" : "AI add-on removal requested", entity: "subscription" });
  return r;
}

export async function requestCancel(ctx: Ctx, reason: string) {
  authorize(ctx, "users");
  const r = await queue(ctx, "cancel", { reason: String(reason ?? "").trim().slice(0, 500) });
  await writeAudit(db, { tenantId: ctx.tenantId, userId: ctx.userId, userName: ctx.userName, action: "Cancellation requested", entity: "subscription", detail: String(reason ?? "").slice(0, 200) });
  return r;
}

export const paymentSchema = z.object({
  product: z.enum(["starter", "pro", "multi", "ai"]), cycle: z.enum(["m", "y"]),
  reference: z.string().trim().min(6, "Enter the UPI reference (UTR) or bank transaction number.").max(60),
  paidOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter the payment date."),
  amountRupees: z.coerce.number<string | number>().positive("Enter the amount you paid.").max(10_000_000),
  payer: z.string().trim().max(120).default(""),
});

/** "I've paid": Medoro checks the payment, then the next licence carries the new paid-until date and the invoice. */
export async function claimPayment(ctx: Ctx, raw: z.input<typeof paymentSchema>) {
  authorize(ctx, "users");
  const i = paymentSchema.parse(raw);
  if (i.paidOn > isoOf(new Date(Date.now() + 86400_000))) throw new UserError("The payment date can’t be in the future.");
  const r = await queue(ctx, "payment", i);
  await writeAudit(db, { tenantId: ctx.tenantId, userId: ctx.userId, userName: ctx.userName, action: "Payment reported to Medoro", entity: "subscription", detail: `₹${i.amountRupees} · ${i.reference}` });
  return r;
}

// ── Help: support tickets.
export const ticketSchema = z.object({
  subject: z.string().trim().min(4, "Add a short subject.").max(140),
  message: z.string().trim().min(1, "Describe the problem.").max(4000),
  category: z.string().trim().max(40).default("General"),
});

export async function openTicket(ctx: Ctx, raw: z.input<typeof ticketSchema>) {
  const i = ticketSchema.parse(raw);
  if (!licenceServer()) throw new UserError("This installation isn’t connected to Medoro, so tickets can’t be sent from here. Contact Medoro support directly.");
  const row = await db.licenceOutbox.create({ data: { tenantId: ctx.tenantId, kind: "ticket", payload: i, createdBy: ctx.userName } });
  // Straight to the ticket endpoint; if that fails it goes with the next check-in.
  const cred = await credentials(ctx.tenantId);
  if (cred) {
    let result: { id: string; ok: boolean; ref?: string; error?: string } | null = null;
    try { result = await call("/api/license/ticket", { id: row.id, kind: "ticket", payload: i, createdBy: ctx.userName }, cred, 8000); } catch { /* sent with the next check-in */ }
    if (result && !result.ok) {
      await db.licenceOutbox.delete({ where: { id: row.id } });
      throw new UserError(result.error ?? "Medoro couldn’t accept that ticket.");
    }
    if (result) await db.licenceOutbox.update({ where: { id: row.id }, data: { sentAt: new Date(), result } });
  }
  await checkIn(ctx.tenantId, { timeoutMs: 8000 });
  const after = await db.licenceOutbox.findUniqueOrThrow({ where: { id: row.id } });
  return { sent: !!after.sentAt, code: (after.result as { ref?: string } | null)?.ref ?? null };
}

export async function replyTicket(ctx: Ctx, code: string, text: string) {
  const t = z.string().trim().min(1, "Write a reply first.").max(4000).parse(text);
  const inbox = await inboxOf(ctx.tenantId);
  if (!inbox.tickets?.some((x) => x.code === code)) throw new UserError("Ticket not found.");
  return queue(ctx, "ticket_reply", { code, text: t });
}

export async function inboxOf(tenantId: string): Promise<Inbox> {
  const m = await db.subscriptionMeta.findUnique({ where: { tenantId }, select: { inbox: true } });
  return (m?.inbox ?? {}) as Inbox;
}

/** Tickets from the last licence, plus ones written here that haven't reached Medoro yet. */
export async function supportInbox(tenantId: string) {
  const [m, pending] = await Promise.all([
    db.subscriptionMeta.findUnique({ where: { tenantId }, select: { inbox: true, supportSeenAt: true } }),
    db.licenceOutbox.findMany({ where: { tenantId, kind: { in: ["ticket", "ticket_reply"] }, sentAt: null }, orderBy: { createdAt: "desc" } }),
  ]);
  const tickets = ((m?.inbox ?? {}) as Inbox).tickets ?? [];
  const seen = m?.supportSeenAt?.getTime() ?? 0;
  return {
    tickets, seenAt: m?.supportSeenAt?.toISOString() ?? null,
    unread: tickets.reduce((a, t) => a + t.messages.filter((x) => !x.fromCustomer && Date.parse(x.at) > seen).length, 0),
    pending: pending.map((p) => ({ id: p.id, kind: p.kind, payload: p.payload as { subject?: string; message?: string; code?: string; text?: string }, by: p.createdBy, at: p.createdAt.toISOString() })),
    connected: !!licenceServer(),
  };
}

export async function markSupportSeen(tenantId: string) {
  await db.subscriptionMeta.updateMany({ where: { tenantId }, data: { supportSeenAt: new Date() } });
}

// ── Remote-access requests from Medoro support (Privacy & data).
export async function remoteRequests(tenantId: string) {
  const [inbox, decided] = await Promise.all([
    inboxOf(tenantId),
    db.licenceOutbox.findMany({ where: { tenantId, kind: "remote_decision" }, select: { payload: true } }),
  ]);
  const done = new Set(decided.map((d) => (d.payload as { requestId?: string }).requestId));
  return (inbox.remote ?? []).filter((r) => !done.has(r.id));
}

/** The owner answers a support request. Approving creates the usual single-use, read-only link and sends it to Medoro. */
export async function decideRemoteRequest(ctx: Ctx, requestId: string, approve: boolean, minutes: number, origin: string) {
  authorize(ctx, "users");
  const r = (await remoteRequests(ctx.tenantId)).find((x) => x.id === requestId);
  if (!r) throw new UserError("That request was already answered or has expired.");
  if (!approve) {
    await queue(ctx, "remote_decision", { requestId, approved: false });
    await writeAudit(db, { tenantId: ctx.tenantId, userId: ctx.userId, userName: ctx.userName, action: "Support access request declined", entity: "support", detail: `${r.by}${r.ticket ? ` · ${r.ticket}` : ""}` });
    return null;
  }
  const g = await grantSupport(ctx, { minutes, reason: `Requested by ${r.by} (Medoro)${r.ticket ? ` · ${r.ticket}` : ""}` }, origin);
  const sent = await queue(ctx, "remote_decision", { requestId, approved: true, link: g.link, expiresAt: g.expiresAt });
  return { ...g, sent: sent.sent };
}

/** Everything the Plan screen shows. */
/** The link that opens Medoro's pay page for this installation (signed with its instance token, valid 2 hours). */
export async function payOnlineLink(tenantId: string) {
  const server = licenceServer(), cred = await credentials(tenantId);
  if (!server || !cred) throw new UserError("This installation isn’t connected to Medoro yet. Press Check now first.");
  return `${server}/pay?${new URLSearchParams({ l: cred.licenceId, s: requestSignature(cred.token, payLinkBody(cred.licenceId)) })}`;
}

export async function planView(tenantId: string) {
  const [m, access, outbox] = await Promise.all([
    db.subscriptionMeta.findUnique({ where: { tenantId } }),
    accessFor(tenantId),
    db.licenceOutbox.findMany({ where: { tenantId, kind: { in: ["addon_add", "addon_remove", "cancel", "payment"] } }, orderBy: { createdAt: "desc" }, take: 20 }),
  ]);
  const inbox = (m?.inbox ?? {}) as Inbox;
  const status = new Map((inbox.billing ?? []).filter((b) => b.requestId).map((b) => [b.requestId!, b.status]));
  return {
    plan: m?.plan ?? null, addons: m?.addons ?? [], status: m?.status ?? null, access,
    licenceId: m?.licenceId ?? null, signed: !!m?.signedDoc, checkedAt: m?.checkedAt?.toISOString() ?? null, issuedAt: m?.issuedAt?.toISOString() ?? null, checkError: m?.checkError ?? null,
    server: licenceServer(), verifying: !!process.env.LICENSE_PUBLIC_KEY, customerCode: inbox.customerCode ?? null,
    invoices: inbox.invoices ?? [], billing: inbox.billing ?? [],
    requests: outbox.map((o) => ({ id: o.id, kind: o.kind, payload: o.payload as Record<string, unknown>, by: o.createdBy, at: o.createdAt.toISOString(), sent: !!o.sentAt, error: (o.result as { error?: string } | null)?.error ?? null, status: status.get(o.id) ?? (o.sentAt ? "open" : "queued") })),
  };
}
