import "server-only";
/**
 * UPI & Bank Connect, phases 3–6: connections to banks, Account Aggregator partners and payment providers, and the
 * sync engine that pulls their transactions. Provider-specific work lives in adapters (connectors/); this file is
 * the same for all of them:
 *   - connect: the provider's own authorisation (a redirect) with a single-use state bound to the user; a connection
 *     becomes active only when the provider confirms it;
 *   - consent: history, expiry (checked before every fetch), renewal and revocation;
 *   - sync: a job queue (initial, scheduled, manual, webhook) with one job per connection at a time, cursors saved
 *     only after delivery, retries with exponential backoff, the provider's rate limits honoured, a time budget per run;
 *   - delivery: Drive pharmacies get each batch sealed for their counters (FinInbox, nothing readable kept); a
 *     pharmacy whose data is on this server gets statement lines, then the usual matching to books and bills;
 *   - logs: counts only.
 * No adapter is live until a provider agreement is signed, so in production nothing here can be connected yet.
 */
import { createHash, randomBytes } from "node:crypto";
import { db } from "@/server/db";
import { writeAudit } from "@/server/audit";
import { authorize, authorizeView, type Ctx } from "@/server/context";
import { UserError } from "@/server/action";
import { seal, unseal } from "@/server/vault";
import { log } from "@/server/log";
import { rateLimit } from "@/server/rate-limit";
import { dateOnly } from "@/lib/dates";
import { driveModeOn } from "@/domain/system/drive-mode";
import { sealJsonForDevice, FIN_AAD } from "@/drivedb/inbox";
import { connectable, connector, connectors } from "./connectors";
import { AuthFailed, ConsentExpired, ConsentRevoked, ConnectorError, RateLimited, type ConnectorDef, type FinBatch, type SourceRecord } from "./connectors/types";
import { LABEL_TEXT } from "./providers";

const STATE_TTL_MS = 10 * 60_000;
const RUN_BUDGET_MS = 240_000;
const BACKOFF_MIN = [1, 2, 4, 8, 16];
const GIVE_UP_MS = 24 * 3600_000;
export const INBOX_KEEP_DAYS = 14;
const BATCH = 200;

const baseUrl = () => (process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
export const callbackUrl = () => `${baseUrl()}/api/financial-connections/bank/callback`;
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
const secretOf = (c: { encryptedSecret: Uint8Array | null }) => (c.encryptedSecret ? JSON.parse(unseal(c.encryptedSecret).toString()) : null);
const cfg = (c: { config: unknown }) => (c.config ?? {}) as Record<string, unknown>;

function needAdapter(def: ConnectorDef | null) {
  if (!def) throw new UserError("Unknown connection type.");
  if (!def.adapter || !connectable(def)) throw new UserError(`${def.name}: ${LABEL_TEXT[def.label]}. Upload bank statements meanwhile.`);
  return def.adapter;
}

// ---------- what the screens show ----------

/** Every connector with its honest status; `connectable` is true only when an adapter is live. */
export function providersView() {
  return connectors().map((c) => ({ id: c.id, kind: c.kind, name: c.name, label: c.label, labelText: LABEL_TEXT[c.label], connectable: connectable(c), capabilities: c.capabilities }));
}

const view = (c: Awaited<ReturnType<typeof db.finConnection.findFirstOrThrow>>) => ({
  id: c.id, kind: c.kind, connector: c.connector, status: c.status, displayName: c.displayName, accountMasked: c.accountMasked,
  consentExpiresAt: c.consentExpiresAt?.toISOString() ?? null, syncEveryMin: c.syncEveryMin, lastSyncAt: c.lastSyncAt?.toISOString() ?? null,
  lastError: c.lastError, lastErrorAt: c.lastErrorAt?.toISOString() ?? null, createdAt: c.createdAt.toISOString(),
});

export async function listConnections(ctx: Ctx, kinds?: ("bank" | "aa" | "provider")[]) {
  authorizeView(ctx, "payments", "integrations", "reports");
  const rows = await db.finConnection.findMany({ where: { tenantId: ctx.tenantId, status: { not: "disconnected" }, ...(kinds ? { kind: { in: kinds } } : {}) }, orderBy: { createdAt: "asc" } });
  return rows.map(view);
}

export async function syncHistory(ctx: Ctx, limit = 50) {
  authorizeView(ctx, "payments", "integrations", "reports");
  const logs = await db.finSyncLog.findMany({ where: { tenantId: ctx.tenantId }, orderBy: { startedAt: "desc" }, take: limit });
  const names = new Map((await db.finConnection.findMany({ where: { id: { in: logs.map((l) => l.connectionId) } }, select: { id: true, displayName: true } })).map((c) => [c.id, c.displayName]));
  return logs.map((l) => ({ ...l, connection: names.get(l.connectionId) ?? "", startedAt: l.startedAt.toISOString(), endedAt: l.endedAt.toISOString() }));
}

// ---------- connecting ----------

async function newState(tenantId: string, userId: string, connectionId: string) {
  const state = randomBytes(32).toString("base64url");
  await db.finAuthState.create({ data: { id: hash(state), tenantId, userId, connectionId, expiresAt: new Date(Date.now() + STATE_TTL_MS) } });
  return state;
}

/** Owner / integrations: starts the provider's authorisation. Returns where to send the browser. */
export async function startConnection(ctx: Ctx, connectorId: string) {
  authorize(ctx, "integrations");
  const def = connector(connectorId);
  const adapter = needAdapter(def);
  if (!(await rateLimit(`fin-connect:${ctx.tenantId}`, 5, 3600_000))) throw new UserError("Too many connection attempts. Try again in an hour.");
  const c = await db.finConnection.create({ data: { tenantId: ctx.tenantId, kind: def!.kind, connector: def!.id, displayName: def!.name, createdBy: ctx.userId } });
  const state = await newState(ctx.tenantId, ctx.userId, c.id);
  try {
    const r = await adapter.start({ connectionId: c.id, state, returnUrl: callbackUrl() });
    if (def!.capabilities.consent) await db.finConsent.create({ data: { tenantId: ctx.tenantId, connectionId: c.id, event: "requested", externalId: r.externalId ?? null, userId: ctx.userId } });
    await writeAudit(db, { tenantId: ctx.tenantId, userId: ctx.userId, userName: ctx.userName, action: "Bank / provider connection started", entity: "fin_connection", entityId: c.id, detail: def!.name });
    return { connectionId: c.id, redirectUrl: r.redirectUrl };
  } catch (e) {
    await db.finConnection.update({ where: { id: c.id }, data: { status: "error", lastError: errText(e), lastErrorCode: codeOf(e), lastErrorAt: new Date() } });
    throw new UserError(`${def!.name} couldn’t start the connection: ${errText(e)}`);
  }
}

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 300);
const codeOf = (e: unknown) => (e instanceof ConnectorError ? e.code : "error");

/**
 * The provider sent the browser back. The state must be unused, unexpired and belong to this user and pharmacy; only
 * the adapter's confirmation turns the connection active (or renews its consent).
 */
export async function completeCallback(ctx: Ctx, params: URLSearchParams) {
  authorize(ctx, "integrations");
  const state = params.get("state") ?? "";
  const s = state ? await db.finAuthState.findUnique({ where: { id: hash(state) } }) : null;
  if (!s || s.tenantId !== ctx.tenantId || s.userId !== ctx.userId) throw new UserError("This connection link isn’t valid for you. Start again from UPI & Bank Connect.");
  if (s.usedAt) throw new UserError("This connection link was already used. Start again.");
  if (s.expiresAt < new Date()) throw new UserError("This connection link has expired. Start again.");
  const used = await db.finAuthState.updateMany({ where: { id: s.id, usedAt: null }, data: { usedAt: new Date() } });
  if (!used.count) throw new UserError("This connection link was already used. Start again.");
  const c = await db.finConnection.findFirstOrThrow({ where: { id: s.connectionId, tenantId: ctx.tenantId } });
  const adapter = needAdapter(connector(c.connector));
  const r = await adapter.callback(params).catch((e): Awaited<ReturnType<typeof adapter.callback>> => ({ ok: false, reason: "failed", message: errText(e) }));
  const renewing = c.status !== "pending";
  if (!r.ok) {
    if (!renewing) await db.finConnection.update({ where: { id: c.id }, data: { status: r.reason === "denied" ? "disconnected" : "error", lastError: r.message, lastErrorCode: r.reason, lastErrorAt: new Date() } });
    if (connector(c.connector)!.capabilities.consent) await db.finConsent.create({ data: { tenantId: ctx.tenantId, connectionId: c.id, event: "rejected", userId: ctx.userId } });
    await writeAudit(db, { tenantId: ctx.tenantId, userId: ctx.userId, userName: ctx.userName, action: "Bank / provider connection not authorised", entity: "fin_connection", entityId: c.id, detail: `${c.displayName}: ${r.message}` });
    return { ok: false as const, message: r.message };
  }
  const updated = await db.finConnection.update({ where: { id: c.id }, data: {
    status: "active", displayName: r.displayName.slice(0, 80), accountMasked: r.accountMasked.slice(0, 20), lastError: null, lastErrorCode: null, lastErrorAt: null,
    ...(r.secret !== undefined ? { encryptedSecret: new Uint8Array(seal(JSON.stringify(r.secret))) } : {}),
    ...(r.config ? { config: r.config as object } : {}), consentExpiresAt: r.consentExpiresAt ?? null,
  } });
  if (connector(c.connector)!.capabilities.consent) await db.finConsent.create({ data: { tenantId: ctx.tenantId, connectionId: c.id, event: renewing ? "renewed" : "approved", externalId: r.externalId ?? null, expiresAt: r.consentExpiresAt ?? null, userId: ctx.userId } });
  await writeAudit(db, { tenantId: ctx.tenantId, userId: ctx.userId, userName: ctx.userName, action: renewing ? "Bank / provider consent renewed" : "Bank / provider connected", entity: "fin_connection", entityId: c.id, detail: `${updated.displayName} ${updated.accountMasked}` });
  await enqueue(c.id, ctx.tenantId, renewing ? "manual" : "initial");
  return { ok: true as const, connection: view(updated) };
}

async function own(ctx: Ctx, id: string) {
  const c = await db.finConnection.findFirst({ where: { id, tenantId: ctx.tenantId } });
  if (!c) throw new UserError("Connection not found.");
  return c;
}

export async function refreshConsent(ctx: Ctx, id: string) {
  authorize(ctx, "integrations");
  const c = await own(ctx, id);
  const adapter = needAdapter(connector(c.connector));
  if (!adapter.refreshConsent) throw new UserError("This connection has no consent to renew.");
  if (c.status === "revoked" || c.status === "disconnected") throw new UserError("Connect again instead.");
  const state = await newState(ctx.tenantId, ctx.userId, c.id);
  const r = await adapter.refreshConsent({ secret: secretOf(c), config: cfg(c), state, returnUrl: callbackUrl() });
  await db.finConsent.create({ data: { tenantId: ctx.tenantId, connectionId: c.id, event: "requested", externalId: r.externalId ?? null, userId: ctx.userId } });
  return { redirectUrl: r.redirectUrl };
}

/** Revokes at the provider, then stops using the connection here (also if the provider can't be reached). */
export async function revokeConnection(ctx: Ctx, id: string, then: "revoked" | "disconnected" = "revoked") {
  authorize(ctx, "integrations");
  const c = await own(ctx, id);
  const def = connector(c.connector);
  let warning: string | null = null;
  if (def?.adapter && c.encryptedSecret && c.status !== "revoked") {
    try { await def.adapter.revoke({ secret: secretOf(c), config: cfg(c) }); }
    catch (e) { warning = `${def.name} didn’t confirm the revocation (${errText(e)}). Medoro has stopped using it; also revoke it in the ${def.kind === "aa" ? "Account Aggregator" : "provider’s"} app.`; }
  }
  await db.$transaction(async (tx) => {
    await tx.finConnection.update({ where: { id: c.id }, data: { status: then, encryptedSecret: null, cursor: undefined } });
    await tx.finSyncJob.updateMany({ where: { connectionId: c.id, status: { in: ["queued", "running"] } }, data: { status: "failed", lastError: "Connection revoked", finishedAt: new Date() } });
    if (def?.capabilities.consent) await tx.finConsent.create({ data: { tenantId: ctx.tenantId, connectionId: c.id, event: "revoked", userId: ctx.userId } });
    await writeAudit(tx, { tenantId: ctx.tenantId, userId: ctx.userId, userName: ctx.userName, action: then === "revoked" ? "Bank / provider consent revoked" : "Bank / provider disconnected", entity: "fin_connection", entityId: c.id, detail: `${c.displayName}${warning ? " · provider didn't confirm" : ""}` });
  });
  return { ok: true, warning };
}
export const disconnectConnection = (ctx: Ctx, id: string) => revokeConnection(ctx, id, "disconnected");

// ---------- sync jobs ----------

async function enqueue(connectionId: string, tenantId: string, trigger: "initial" | "schedule" | "manual" | "webhook", runAfter = new Date()) {
  const open = await db.finSyncJob.findFirst({ where: { connectionId, status: { in: ["queued", "running"] } } });
  if (open) return open.id;
  return (await db.finSyncJob.create({ data: { tenantId, connectionId, trigger, runAfter } })).id;
}

/** "Sync now": one per connection every 10 minutes. */
export async function requestSync(ctx: Ctx, id: string) {
  authorize(ctx, "payments");
  const c = await own(ctx, id);
  if (c.status !== "active") throw new UserError(c.status === "expired" ? "The consent has expired. Renew it first." : "This connection isn’t active.");
  if (!(await rateLimit(`fin-sync:${c.id}`, 1, 10 * 60_000))) throw new UserError("This connection synced in the last 10 minutes. Try again shortly.");
  return { jobId: await enqueue(c.id, ctx.tenantId, "manual") };
}

export async function requestSyncAll(ctx: Ctx) {
  authorize(ctx, "payments");
  const conns = await db.finConnection.findMany({ where: { tenantId: ctx.tenantId, status: "active" } });
  let queued = 0;
  for (const c of conns) if (await rateLimit(`fin-sync:${c.id}`, 1, 10 * 60_000)) { await enqueue(c.id, ctx.tenantId, "manual"); queued++; }
  return { queued, connections: conns.length };
}

/** Owner sets how often to poll (never more often than the provider allows; null = off). */
export async function setSyncInterval(ctx: Ctx, id: string, minutes: number | null) {
  authorize(ctx, "integrations");
  const c = await own(ctx, id);
  const def = connector(c.connector);
  if (minutes != null) {
    if (!def?.capabilities.minPollMin) throw new UserError("This provider can’t be checked on a schedule.");
    if (!Number.isInteger(minutes) || minutes < def.capabilities.minPollMin || minutes > 7 * 1440) throw new UserError(`Pick an interval of at least ${def.capabilities.minPollMin} minutes.`);
  }
  await db.finConnection.update({ where: { id: c.id }, data: { syncEveryMin: minutes } });
  return true;
}

/** Queues scheduled syncs that are due. */
export async function scheduleDue(now = new Date()) {
  const conns = await db.finConnection.findMany({ where: { status: "active", syncEveryMin: { not: null } } });
  let n = 0;
  for (const c of conns) {
    if (c.lastSyncAt && now.getTime() - c.lastSyncAt.getTime() < c.syncEveryMin! * 60_000) continue;
    await enqueue(c.id, c.tenantId, "schedule", now); n++;
  }
  return n;
}

/** Claims and runs due jobs within a time budget. Returns how many ran. */
export async function runSyncJobs(now = new Date(), budgetMs = RUN_BUDGET_MS) {
  const until = Date.now() + budgetMs;
  // A run that died mid-way (process stopped): back in the queue.
  await db.finSyncJob.updateMany({ where: { status: "running", lockedUntil: { lt: now } }, data: { status: "queued" } });
  let ran = 0;
  while (Date.now() < until) {
    const claimed = await db.$queryRaw<{ id: string }[]>`
      UPDATE "FinSyncJob" SET status = 'running', "lockedUntil" = ${new Date(now.getTime() + 10 * 60_000)}, attempts = attempts + 1
       WHERE id = (SELECT id FROM "FinSyncJob" WHERE status = 'queued' AND "runAfter" <= ${now} ORDER BY "runAfter" LIMIT 1 FOR UPDATE SKIP LOCKED)
      RETURNING id`;
    if (!claimed.length) break;
    await runJob(claimed[0].id, now, until);
    ran++;
  }
  return ran;
}

async function runJob(jobId: string, now: Date, until: number) {
  const job = await db.finSyncJob.findUniqueOrThrow({ where: { id: jobId } });
  const c = await db.finConnection.findUniqueOrThrow({ where: { id: job.connectionId } });
  const started = new Date();
  let fetched = 0, delivered = 0;
  const finish = async (status: "done" | "failed" | "queued", err: { code: string; message: string } | null, runAfter?: Date) => {
    await db.finSyncJob.update({ where: { id: job.id }, data: { status, lastError: err?.message ?? null, lockedUntil: null, ...(status === "queued" ? { runAfter } : { finishedAt: new Date() }) } });
    await db.finSyncLog.create({ data: { tenantId: c.tenantId, connectionId: c.id, trigger: job.trigger, startedAt: started, endedAt: new Date(), fetched, delivered, errors: err ? 1 : 0, errorCode: err?.code ?? null } });
  };
  const def = connector(c.connector);
  if (!def?.adapter || c.status !== "active") return finish("failed", { code: "not_active", message: def?.adapter ? "Connection isn’t active." : `${def?.name ?? c.connector} isn’t available.` });
  if (c.consentExpiresAt && c.consentExpiresAt <= now) {
    await db.finConnection.update({ where: { id: c.id }, data: { status: "expired", lastError: new ConsentExpired().message, lastErrorCode: "consent_expired", lastErrorAt: now } });
    if (def.capabilities.consent) await db.finConsent.create({ data: { tenantId: c.tenantId, connectionId: c.id, event: "expired" } });
    return finish("failed", { code: "consent_expired", message: new ConsentExpired().message });
  }
  try {
    let cursor: unknown = c.cursor ?? null;
    const since = new Date(now.getTime() - def.capabilities.historyDays * 86400_000);
    for (;;) {
      const r = await def.adapter.fetch({ secret: secretOf(c), config: cfg(c), cursor, since });
      fetched += r.records.length;
      delivered += await deliver(c, r.records);
      cursor = r.cursor;
      // Saved only after the batch is delivered: a failure later fetches from here again.
      await db.finConnection.update({ where: { id: c.id }, data: { cursor: (cursor ?? undefined) as object | undefined } });
      if (!r.more) break;
      if (Date.now() >= until) { await enqueue(c.id, c.tenantId, job.trigger as "manual", new Date()); break; }
    }
    await db.finConnection.update({ where: { id: c.id }, data: { lastSyncAt: new Date(), lastError: null, lastErrorCode: null, lastErrorAt: null } });
    await finish("done", null);
  } catch (e) {
    const err = { code: codeOf(e), message: errText(e) };
    await db.finConnection.update({ where: { id: c.id }, data: { lastError: err.message, lastErrorCode: err.code, lastErrorAt: new Date() } });
    if (e instanceof RateLimited) return finish("queued", err, new Date(Date.now() + Math.max(30, e.retryAfterSec) * 1000));
    if (e instanceof AuthFailed || e instanceof ConsentRevoked || e instanceof ConsentExpired) {
      const status = e instanceof ConsentExpired ? "expired" : e instanceof ConsentRevoked ? "revoked" : "error";
      await db.finConnection.update({ where: { id: c.id }, data: { status } });
      if (def.capabilities.consent && status !== "error") await db.finConsent.create({ data: { tenantId: c.tenantId, connectionId: c.id, event: status } });
      return finish("failed", err);
    }
    // Provider down, timeout, or a bug in the batch: retry with backoff, give up after a day.
    if (Date.now() - job.createdAt.getTime() >= GIVE_UP_MS) return finish("failed", err);
    const wait = (BACKOFF_MIN[job.attempts - 1] ?? 60) * 60_000;
    if (!(e instanceof ConnectorError)) log.error("Bank sync failed.", { err: e, connectionId: c.id });
    return finish("queued", err, new Date(Date.now() + wait));
  }
}

// ---------- delivery ----------

/** Only finished payments are delivered; pending/failed ones are counted in the log and fetched again later by cursor. */
const deliverable = (r: SourceRecord) => r.status === "success" && Number.isInteger(r.amountPaise) && r.amountPaise > 0 && r.currency === "INR" && /^\d{4}-\d{2}-\d{2}$/.test(r.date);

async function deliver(c: { id: string; tenantId: string; connector: string; displayName: string; accountMasked: string; createdBy: string }, records: SourceRecord[]) {
  const ok = records.filter(deliverable);
  if (!ok.length) return 0;
  if (await driveModeOn(c.tenantId)) {
    const devices = await db.driveDevice.findMany({ where: { tenantId: c.tenantId, status: "approved" } });
    if (!devices.length) throw new ConnectorError("No approved counter to receive the transactions yet.", "no_device");
    for (let i = 0; i < ok.length; i += BATCH) {
      const part = ok.slice(i, i + BATCH);
      const batchId = hash(`${c.id}|${part.map((r) => r.sourceRef).join(",")}`).slice(0, 40);
      const payload: FinBatch = { connectionId: c.id, connector: c.connector, name: c.displayName, accountMasked: c.accountMasked, records: part };
      const rows = await Promise.all(devices.map(async (d) => ({ tenantId: c.tenantId, deviceId: d.deviceId, connectionId: c.id, batchId, sealed: await sealJsonForDevice(d.publicKey as JsonWebKey, payload, FIN_AAD) })));
      await db.finInbox.createMany({ data: rows, skipDuplicates: true });
    }
    return ok.length;
  }
  return deliverToServer(c, ok);
}


/** A pharmacy whose data is on this server: the records become statement lines, then the usual matching runs. */
async function deliverToServer(c: { id: string; tenantId: string; connector: string; displayName: string; createdBy: string }, records: SourceRecord[]) {
  const { autoMatch } = await import("@/domain/accounting/bank");
  const { autoAllocateBills } = await import("./bills");
  const fp = (r: SourceRecord) => hash(`${c.connector}|${c.id}|${r.sourceRef}`).slice(0, 40);
  const ctx = await systemCtx(c.tenantId, c.createdBy);
  return db.$transaction(async (tx) => {
    const seen = new Set((await tx.bankLine.findMany({ where: { tenantId: c.tenantId, fingerprint: { in: records.map(fp) } }, select: { fingerprint: true } })).map((x) => x.fingerprint));
    const fresh = records.filter((r) => !seen.has(fp(r)));
    if (!fresh.length) return 0;
    const st = await tx.bankStatement.create({ data: { tenantId: c.tenantId, fileName: `Sync: ${c.displayName}`.slice(0, 120), lines: fresh.length, createdBy: c.createdBy } });
    await tx.bankLine.createMany({ data: fresh.map((r, i) => ({
      tenantId: c.tenantId, statementId: st.id, date: dateOnly(r.date), description: [r.description, r.utr && !r.description.includes(r.utr) ? r.utr : "", r.counterpartyVpa ?? ""].filter(Boolean).join(" ").slice(0, 200),
      ref: (r.utr ?? r.bankRef ?? "").slice(0, 40) || null, amountPaise: BigInt(r.direction === "credit" ? r.amountPaise : -r.amountPaise), row: i, fingerprint: fp(r),
    })) });
    await autoMatch(tx, ctx);
    await autoAllocateBills(tx, ctx);
    return fresh.length;
  }, { timeout: 60_000 });
}

/** The pharmacy's own context for postings made by a sync (as the user who connected it). */
async function systemCtx(tenantId: string, userId: string): Promise<Ctx> {
  const [t, u, b] = await Promise.all([
    db.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { name: true } }),
    db.user.findFirst({ where: { id: userId, tenantId }, select: { name: true, email: true } }),
    db.branch.findFirstOrThrow({ where: { tenantId, active: true }, orderBy: { createdAt: "asc" }, select: { id: true, name: true, code: true } }),
  ]);
  return {
    tenantId, tenantName: t.name, userId, userName: `${u?.name ?? "Owner"} (bank sync)`, userEmail: u?.email ?? "", realRole: "Owner", role: "Owner",
    perms: ["payments"], branchId: b.id, branchName: b.name, branchCode: b.code, branches: [b], lang: "en", sessionId: "bank-sync", counterId: null, counterName: null,
  };
}

// ---------- webhooks ----------

/**
 * A provider's notification for one pharmacy. Each active connection of that provider tries the signature with its
 * own secret; none accepts → 401. Unknown or unavailable provider → 404. Nothing is stored for refused calls.
 */
export async function handleWebhook(connectorId: string, tenantId: string, raw: string, headers: Headers) {
  const def = connector(connectorId);
  if (!def?.adapter?.verifyWebhook || !connectable(def)) return { status: 404, note: "unknown" };
  const conns = await db.finConnection.findMany({ where: { tenantId, connector: connectorId, status: "active" } });
  for (const c of conns) {
    const records = await def.adapter.verifyWebhook({ raw, headers, secret: secretOf(c), config: cfg(c) }).catch(() => null);
    if (!records) continue;
    const started = new Date();
    const delivered = await deliver(c, records);
    await db.finSyncLog.create({ data: { tenantId, connectionId: c.id, trigger: "webhook", startedAt: started, endedAt: new Date(), fetched: records.length, delivered } });
    return { status: 200, note: `delivered ${delivered}` };
  }
  return { status: 401, note: "bad signature" };
}

// ---------- counters' inbox ----------

export async function finInboxFor(tenantId: string, deviceId: string) {
  return (await db.finInbox.findMany({ where: { tenantId, deviceId }, orderBy: { createdAt: "asc" }, take: 20 })).map((r) => ({ batchId: r.batchId, sealed: r.sealed }));
}
/** A counter recorded these batches: every device's copy goes (the counters sync among themselves). */
export async function ackFinInbox(tenantId: string, batchIds: string[]) {
  const ids = batchIds.filter((x) => /^[0-9a-f]{40}$/.test(x)).slice(0, 50);
  if (!ids.length) return 0;
  return (await db.finInbox.deleteMany({ where: { tenantId, batchId: { in: ids } } })).count;
}

/** Cron: schedule, run, and clean up (inbox entries older than 14 days, used or expired auth states). */
export async function finSyncTick(now = new Date(), budgetMs = RUN_BUDGET_MS) {
  await scheduleDue(now);
  const ran = await runSyncJobs(now, budgetMs);
  await db.finInbox.deleteMany({ where: { createdAt: { lt: new Date(now.getTime() - INBOX_KEEP_DAYS * 86400_000) } } });
  await db.finAuthState.deleteMany({ where: { OR: [{ expiresAt: { lt: new Date(now.getTime() - 86400_000) } }, { usedAt: { lt: new Date(now.getTime() - 86400_000) } }] } });
  return ran;
}

/** Owner's daily email: connections failing for a day, consents expiring within 7 days. */
export async function connectionAlerts(tenantId: string, now = new Date()) {
  const conns = await db.finConnection.findMany({ where: { tenantId, status: { in: ["active", "expired", "error"] } } });
  const out: string[] = [];
  for (const c of conns) {
    if (c.status === "expired") out.push(`${c.displayName}: the consent has expired. Renew it under UPI & Bank Connect to keep syncing.`);
    else if (c.status === "error") out.push(`${c.displayName} stopped syncing: ${c.lastError ?? "error"}. Connect it again under UPI & Bank Connect.`);
    else if (c.consentExpiresAt && c.consentExpiresAt.getTime() - now.getTime() <= 7 * 86400_000) out.push(`${c.displayName}: the consent expires on ${c.consentExpiresAt.toISOString().slice(0, 10)}. Renew it under UPI & Bank Connect.`);
    else if (c.lastErrorAt && (!c.lastSyncAt || now.getTime() - c.lastSyncAt.getTime() >= 86400_000) && now.getTime() - c.lastErrorAt.getTime() < 86400_000) out.push(`${c.displayName} hasn’t synced for a day: ${c.lastError}.`);
  }
  return out;
}
