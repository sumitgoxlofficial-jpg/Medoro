import "server-only";
import { db } from "@/server/db";
import { writeAudit } from "@/server/audit";
import { authorize, type Ctx } from "@/server/context";
import { UserError } from "@/server/action";
import { enforce, userKey } from "@/server/ratelimit";
import { deriveState, explain, type Evidence, type HealthState } from "./health-state";
import { driveQuota, driveState } from "./gdrive";
import { dataInDrive, serverBackupsOff } from "./drive-state";
import { waStatus } from "@/domain/comms/whatsapp";
import { phoneLinkStatus, syncTemplates } from "@/domain/comms/whatsapp";
import { isPhone } from "@/domain/comms/delivery";
import { ocrConfigured } from "@/domain/purchasing/ocr";
import { aiStatus } from "@/domain/ai/settings";

/**
 * Integration Health Centre.
 *
 * Two kinds of check:
 *  - "live" ones read facts the system already has (a database round trip, the last verified backup, the scheduler
 *    heartbeat, message delivery results). They are re-evaluated on every view.
 *  - "explicit" ones talk to an outside service (Google Drive, WhatsApp, OCR, AI). They run only when an authorised user
 *    presses "Run test", and the result is stored. A stored pass older than 24 hours no longer counts as fresh.
 * Nothing here ever invents a pass: no test, no "Tested", and no "Active" without a passing test.
 */
export const LIVE_KEYS = ["database", "backup", "whatsapp_delivery", "razorpay_webhooks", "jobs", "offline_sync", "audit_integrity"] as const;
export const EXPLICIT_KEYS = ["gdrive", "whatsapp", "ocr", "ai"] as const;
export type HealthKey = (typeof LIVE_KEYS)[number] | (typeof EXPLICIT_KEYS)[number];
export const isExplicit = (k: string): k is (typeof EXPLICIT_KEYS)[number] => (EXPLICIT_KEYS as readonly string[]).includes(k);

export type HealthRow = {
  key: HealthKey; label: string; state: HealthState; reason: string; detail: string | null;
  lastTestAt: string | null; lastSuccessAt: string | null; lastError: string | null; lastErrorAt: string | null;
  /** The user can press "Run test" (explicit checks) or "Check again" (live checks). */
  action: "test" | "recheck";
};

const LABEL: Record<HealthKey, string> = {
  database: "Database connectivity", gdrive: "Google Drive connection", backup: "Backups", whatsapp: "WhatsApp connection",
  whatsapp_delivery: "WhatsApp delivery", razorpay_webhooks: "Razorpay webhooks", ocr: "OCR service", ai: "AI service", jobs: "Background jobs", offline_sync: "Offline device synchronisation", audit_integrity: "Audit trail integrity",
};
export const ORDER: HealthKey[] = ["database", "backup", "gdrive", "whatsapp", "whatsapp_delivery", "razorpay_webhooks", "ocr", "ai", "jobs", "offline_sync", "audit_integrity"];

const DAY = 86400_000;
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 300);

type Probe = Evidence & { detail?: string | null; lastSuccessAt?: Date | null; lastError?: string | null; lastErrorAt?: Date | null };

// ───────────── Live checks ─────────────

async function database(): Promise<Probe> {
  const t = new Date();
  try {
    const [r] = await db.$queryRaw<{ n: bigint }[]>`SELECT count(*)::bigint n FROM "_prisma_migrations" WHERE finished_at IS NOT NULL`;
    return { configured: true, test: "pass", testedAt: t, inUse: true, lastSuccessAt: t, detail: `Round trip OK · ${r.n} migrations applied` };
  } catch (e) { return { configured: true, test: "fail", testedAt: t, error: `Database query failed: ${msg(e)}`, lastError: msg(e), lastErrorAt: t }; }
}

async function backup(tenantId: string): Promise<Probe> {
  const tenant = await db.tenant.findUnique({ where: { id: tenantId }, select: { settings: true } });
  if (serverBackupsOff(tenant?.settings)) {
    return { configured: false, test: "not_run", detail: dataInDrive(tenant?.settings) ? "Records live in the pharmacy’s Google Drive; Medoro keeps no server copy to back up." : "Server backups are off on this hosting; use Drive or a database-level backup." };
  }
  const real = { tenantId, kind: { not: "imported" } };
  const [lastOk, last, key] = await Promise.all([
    db.backupManifest.findFirst({ where: { ...real, status: { in: ["verified", "partial"] } }, orderBy: { startedAt: "desc" } }),
    db.backupManifest.findFirst({ where: { ...real, status: { not: "running" } }, orderBy: { startedAt: "desc" } }),
    db.integration.findUnique({ where: { tenantId_kind: { tenantId, kind: "backup_key" } }, select: { id: true } }),
  ]);
  if (!last && !key) return { configured: false, test: "not_run", detail: "No backup key or backup has been set up." };
  if (!last) return { configured: true, test: "not_run", detail: "Backup key saved; no backup has run yet." };
  const when = last.finishedAt ?? last.startedAt;
  if (last.status === "failed") return { configured: true, test: "fail", testedAt: when, runFailed: true, error: `Last backup failed: ${last.error ?? "unknown error"}`, lastSuccessAt: lastOk?.finishedAt ?? lastOk?.startedAt ?? null, lastError: last.error, lastErrorAt: when, detail: last.driveFileId ? "Drive upload attempted" : "Local copy" };
  const ok = lastOk?.finishedAt ?? lastOk?.startedAt;
  return { configured: true, test: "pass", testedAt: ok, inUse: !!ok && Date.now() - ok.getTime() <= 2 * DAY, lastSuccessAt: ok, detail: `Last verified backup ${ok?.toISOString().slice(0, 16).replace("T", " ")} UTC${lastOk?.driveFileId ? " · in Google Drive" : " · on this server only"}` };
}

async function whatsappDelivery(tenantId: string): Promise<Probe> {
  const rows = await db.waMessage.findMany({ where: { tenantId, status: { in: ["delivered", "read", "failed"] }, createdAt: { gt: new Date(Date.now() - 30 * DAY) } }, orderBy: { updatedAt: "desc" }, take: 20, select: { status: true, errorCode: true, errorKind: true, updatedAt: true } });
  if (!rows.length) return { configured: false, test: "not_run", detail: "No WhatsApp message has reached a final status in the last 30 days." };
  const failed = rows.filter((r) => r.status === "failed"), good = rows.find((r) => r.status !== "failed");
  const failedLatest = rows[0].status === "failed";
  const badRun = failed.length >= 3 && failed.length * 2 >= rows.length;
  const lastFail = failed[0];
  const detail = `${failed.length} of the last ${rows.length} final results failed`;
  if (!good) return { configured: true, test: "fail", testedAt: rows[0].updatedAt, runFailed: true, error: `Every recent message failed (${lastFail.errorCode ?? lastFail.errorKind ?? "no code"}).`, lastError: lastFail.errorCode ?? lastFail.errorKind ?? "failed", lastErrorAt: lastFail.updatedAt, detail };
  return { configured: true, test: failedLatest && badRun ? "fail" : "pass", testedAt: rows[0].updatedAt, runFailed: badRun, inUse: !failedLatest, error: badRun ? `${detail}. Latest error: ${lastFail.errorCode ?? lastFail.errorKind ?? "no code"}.` : null, lastSuccessAt: good.updatedAt, lastError: lastFail ? (lastFail.errorCode ?? lastFail.errorKind ?? "failed") : null, lastErrorAt: lastFail?.updatedAt ?? null, detail };
}

async function razorpayWebhooks(tenantId: string): Promise<Probe> {
  const secret = (process.env.RAZORPAY_WEBHOOK_SECRET ?? "").trim();
  if (!secret && !process.env.RAZORPAY_KEY_ID) return { configured: false, test: "not_run", detail: "Online payments are not set up on this server." };
  if (secret.length < 16) return { configured: true, test: "fail", error: "RAZORPAY_WEBHOOK_SECRET is missing or shorter than 16 characters, so payments can’t be confirmed.", detail: null };
  const [paid, stuck] = await Promise.all([
    db.onlinePayment.findFirst({ where: { tenantId, status: "paid", paymentId: { not: null }, paidAt: { not: null } }, orderBy: { paidAt: "desc" }, select: { paidAt: true } }),
    db.onlinePayment.count({ where: { tenantId, status: "created", createdAt: { lt: new Date(Date.now() - 2 * 3600_000), gt: new Date(Date.now() - 7 * DAY) } } }),
  ]);
  const detail = `${stuck} order(s) created over 2 hours ago still unconfirmed` + " (an abandoned checkout looks the same as a missed webhook)";
  // A webhook-confirmed payment is the only proof that deliveries reach this server and verify; nothing else counts as a test.
  if (!paid) return { configured: true, test: "not_run", detail: `No payment has been confirmed yet. ${detail}` };
  return { configured: true, test: "pass", testedAt: paid.paidAt, lastSuccessAt: paid.paidAt, inUse: Date.now() - paid.paidAt!.getTime() <= 90 * DAY, detail };
}

async function jobs(): Promise<Probe> {
  const h = await db.systemHeartbeat.findUnique({ where: { key: "scheduler" } });
  if (!h || !h.lastRunAt) return { configured: false, test: "not_run", detail: "The scheduler hasn’t run on this server yet." };
  const window = process.env.VERCEL ? 26 * 3600_000 : 15 * 60_000;
  const failedLast = !!h.lastError && (!h.lastOkAt || h.lastRunAt.getTime() > h.lastOkAt.getTime());
  const stale = !h.lastOkAt || Date.now() - h.lastOkAt.getTime() > window;
  const detail = `${h.runs} runs recorded · last run ${h.lastRunAt.toISOString().slice(0, 16).replace("T", " ")} UTC`;
  if (failedLast) return { configured: true, test: "fail", testedAt: h.lastRunAt, runFailed: true, error: `The last scheduled run reported a failure: ${h.lastError}`, lastSuccessAt: h.lastOkAt, lastError: h.lastError, lastErrorAt: h.lastRunAt, detail };
  if (stale) return { configured: true, test: "fail", testedAt: h.lastRunAt, runFailed: true, error: `No successful scheduled run in the last ${process.env.VERCEL ? "26 hours" : "15 minutes"}. Check the cron or the in-process scheduler.`, lastSuccessAt: h.lastOkAt, detail };
  return { configured: true, test: "pass", testedAt: h.lastOkAt, inUse: true, lastSuccessAt: h.lastOkAt, detail };
}

async function offlineSync(tenantId: string): Promise<Probe> {
  const devices = await db.device.findMany({ where: { tenantId, offline: true }, select: { lastSeen: true } });
  if (!devices.length) return { configured: false, test: "not_run", detail: "No device is set up for offline billing." };
  const [posted, conflicts, pending] = await Promise.all([
    db.offlineOp.findFirst({ where: { tenantId, status: { in: ["posted", "resolved"] } }, orderBy: { receivedAt: "desc" }, select: { receivedAt: true } }),
    db.offlineOp.count({ where: { tenantId, status: "conflict" } }),
    db.offlineOp.count({ where: { tenantId, status: "pending" } }),
  ]);
  const detail = `${devices.length} offline device(s) · ${pending} waiting · ${conflicts} in conflict`;
  const oldConflict = conflicts ? await db.offlineOp.findFirst({ where: { tenantId, status: "conflict", receivedAt: { lt: new Date(Date.now() - DAY) } }, select: { id: true } }) : null;
  if (oldConflict) return { configured: true, test: posted ? "pass" : "not_run", testedAt: posted?.receivedAt, runFailed: true, error: `${conflicts} offline change(s) have been in conflict for over a day. Resolve them in Sync.`, lastSuccessAt: posted?.receivedAt ?? null, detail };
  if (!posted) return { configured: true, test: "not_run", detail: `${detail} · nothing has synced yet` };
  return { configured: true, test: "pass", testedAt: posted.receivedAt, lastSuccessAt: posted.receivedAt, inUse: Date.now() - posted.receivedAt.getTime() <= 7 * DAY, detail };
}

/** The daily integrity walk of the audit chain (audit-integrity.ts). Until it has run, the state is "Not configured": no pass is assumed. */
async function auditIntegrity(tenantId: string): Promise<Probe> {
  const r = await db.integrationHealth.findUnique({ where: { tenantId_key: { tenantId, key: "audit_integrity" } } });
  if (!r?.lastTestAt) return { configured: false, test: "not_run", detail: "The daily audit-trail check has not run yet." };
  const fresh = Date.now() - r.lastTestAt.getTime() <= 36 * 3600_000;
  if (r.lastTestOk === false) return { configured: true, test: "fail", testedAt: r.lastTestAt, runFailed: true, error: `Audit trail check failed: ${r.lastError}`, lastSuccessAt: r.lastSuccessAt, lastError: r.lastError, lastErrorAt: r.lastErrorAt, detail: "Treat the records around this event as untrusted until it is explained." };
  return { configured: true, test: "pass", testedAt: r.lastTestAt, inUse: fresh, lastSuccessAt: r.lastSuccessAt, detail: r.detail };
}

// ───────────── Explicit checks (outside services) ─────────────

type Tester = (ctx: Ctx, f: typeof fetch) => Promise<string>;

export const TESTERS: Record<(typeof EXPLICIT_KEYS)[number], Tester> = {
  gdrive: async (ctx) => {
    const q = await driveQuota(ctx.tenantId);
    if (!q) throw new UserError("Google Drive is not connected.");
    return `Drive answered; ${(q.usage / 1e9).toFixed(2)} GB used${q.limit ? ` of ${(q.limit / 1e9).toFixed(0)} GB` : ""}.`;
  },
  whatsapp: async (ctx) => {
    const s = await waStatus(ctx.tenantId);
    if (!s.connected) throw new UserError("WhatsApp is not connected.");
    if (isPhone(s.cfg)) {
      const p = await phoneLinkStatus(ctx);
      if (p.state !== "ready") throw new UserError(`The linked phone is not ready (${p.state}).`);
      return "Linked phone is ready.";
    }
    return `Meta Cloud API answered; ${await syncTemplates(ctx)} template(s) read.`;
  },
  ocr: async (_ctx, f) => {
    const url = process.env.OCR_REMOTE_URL;
    if (!ocrConfigured() || !url) throw new UserError("No OCR engine is configured.");
    const r = await f(url, { method: "HEAD", headers: process.env.OCR_REMOTE_KEY ? { Authorization: `Bearer ${process.env.OCR_REMOTE_KEY}` } : {}, signal: AbortSignal.timeout(10_000) });
    if (r.status === 401 || r.status === 403) throw new UserError(`The OCR engine rejected the key (HTTP ${r.status}).`);
    if (r.status >= 500 || r.status === 404) throw new UserError(`The OCR engine answered HTTP ${r.status}.`);
    return `OCR engine reachable (HTTP ${r.status}). This checks the connection only; it does not read a document.`;
  },
  ai: async (ctx, f) => {
    const s = await aiStatus(ctx);
    if (!s.provider) throw new UserError(s.note ?? "No AI model is configured; answers come from built-in rules.");
    const p = s.provider;
    const url = p.dialect === "ollama" ? new URL("/api/tags", p.url).toString() : p.url.replace(/\/+$/, "").replace(/\/chat\/completions$/, "") + "/models";
    const r = await f(url, { headers: p.key ? { authorization: `Bearer ${p.key}` } : {}, signal: AbortSignal.timeout(10_000) });
    if (!r.ok) throw new UserError(r.status === 401 || r.status === 403 ? `The model server rejected the key (HTTP ${r.status}).` : `The model server answered HTTP ${r.status}.`);
    return `${p.kind === "local" ? "Local" : "Remote"} model server reachable. This checks the connection only; it does not run a prompt.`;
  },
};

async function explicit(ctx: Ctx, key: (typeof EXPLICIT_KEYS)[number]): Promise<Probe> {
  const tenantId = ctx.tenantId;
  const rec = await db.integrationHealth.findUnique({ where: { tenantId_key: { tenantId, key } } });
  const base: Pick<Probe, "test" | "testedAt" | "lastSuccessAt" | "lastError" | "lastErrorAt"> = {
    test: rec?.lastTestOk === true ? "pass" : rec?.lastTestOk === false ? "fail" : "not_run",
    testedAt: rec?.lastTestAt, lastSuccessAt: rec?.lastSuccessAt, lastError: rec?.lastError, lastErrorAt: rec?.lastErrorAt,
  };
  const withErr = (p: Probe): Probe => ({ ...p, error: p.error ?? (base.test === "fail" ? rec?.lastError : null) });
  const since = new Date(Date.now() - 30 * DAY);
  if (key === "gdrive") {
    const d = await driveState(tenantId);
    if (d.status === "off") return { configured: false, test: "not_run", detail: "Google Drive is not connected." };
    if (d.status === "lost") return { configured: true, test: "fail", testedAt: new Date(d.at), runFailed: true, error: `Google refused access: ${d.reason || "reconnect Drive"}`, lastError: d.reason, lastErrorAt: new Date(d.at), detail: d.account };
    const used = await db.backupManifest.findFirst({ where: { tenantId, driveFileId: { not: null }, status: { in: ["verified", "partial"] }, startedAt: { gt: new Date(Date.now() - 8 * DAY) } }, select: { id: true } });
    return withErr({ ...base, configured: true, inUse: !!used, detail: `${d.account} · connected since ${d.since.slice(0, 10)}` });
  }
  if (key === "whatsapp") {
    const w = await waStatus(tenantId);
    if (!w.connected) return { configured: false, test: "not_run", detail: "WhatsApp is not connected." };
    const used = await db.waMessage.findFirst({ where: { tenantId, status: { in: ["delivered", "read"] }, updatedAt: { gt: since } }, select: { id: true } });
    return withErr({ ...base, configured: true, inUse: !!used, detail: w.paused ? "Connected but paused" : isPhone(w.cfg) ? "Linked phone" : "Meta Cloud API" });
  }
  if (key === "ocr") {
    if (!ocrConfigured()) return { configured: false, test: "not_run", detail: "OCR_ENGINE is not set to a remote engine." };
    const used = await db.scanDocument.findFirst({ where: { tenantId, status: { in: ["review", "approved"] }, createdAt: { gt: since } }, select: { id: true } });
    return withErr({ ...base, configured: true, inUse: !!used, detail: "Remote OCR engine" });
  }
  const s = await aiStatus(ctx);
  if (!s.provider) return { configured: false, test: "not_run", detail: s.note ?? "Built-in rules only; no model configured." };
  const users = await db.user.findMany({ where: { tenantId }, select: { id: true } });
  const used = await db.aiAsk.findFirst({ where: { userId: { in: users.map((u) => u.id) }, at: { gt: since } }, select: { id: true } });
  return withErr({ ...base, configured: true, inUse: !!used, detail: `${s.mode} model · ${s.provider.model}` });
}

// ───────────── Public API ─────────────

function row(key: HealthKey, p: Probe, now: Date): HealthRow {
  const state = deriveState(p, now);
  return {
    key, label: LABEL[key], state, reason: explain(state, p, now), detail: p.detail ?? null,
    lastTestAt: p.testedAt?.toISOString() ?? null, lastSuccessAt: p.lastSuccessAt?.toISOString() ?? null, lastError: state === "error" ? (p.error ?? p.lastError ?? null) : (p.lastError ?? null), lastErrorAt: p.lastErrorAt?.toISOString() ?? null,
    action: isExplicit(key) ? "test" : "recheck",
  };
}

async function probe(ctx: Ctx, key: HealthKey): Promise<Probe> {
  try {
    switch (key) {
      case "database": return await database();
      case "backup": return await backup(ctx.tenantId);
      case "whatsapp_delivery": return await whatsappDelivery(ctx.tenantId);
      case "razorpay_webhooks": return await razorpayWebhooks(ctx.tenantId);
      case "jobs": return await jobs();
      case "offline_sync": return await offlineSync(ctx.tenantId);
      case "audit_integrity": return await auditIntegrity(ctx.tenantId);
      default: return await explicit(ctx, key);
    }
  } catch (e) {
    return { configured: true, test: "fail", testedAt: new Date(), error: `The check itself failed: ${msg(e)}`, lastError: msg(e), lastErrorAt: new Date() };
  }
}

export async function healthOverview(ctx: Ctx, now = new Date()): Promise<HealthRow[]> {
  authorize(ctx, "integrations");
  const probes = await Promise.all(ORDER.map((k) => probe(ctx, k)));
  return ORDER.map((k, i) => row(k, probes[i], now));
}

/**
 * Runs the explicit test of one integration, stores the outcome and audits it. A pass is stored only when the tester
 * returns without throwing; any exception is stored as the failure, with its message, and never as a pass.
 */
export async function runHealthTest(ctx: Ctx, key: string, f: typeof fetch = fetch, testers: typeof TESTERS = TESTERS): Promise<HealthRow> {
  authorize(ctx, "integrations");
  if (!isExplicit(key)) throw new UserError("This check runs automatically; use “Check again”.");
  await enforce("healthTest", userKey(ctx));
  const at = new Date();
  let ok = false, detail = "", error: string | null = null;
  try { detail = await testers[key](ctx, f); ok = true; }
  catch (e) { error = e instanceof UserError ? e.message : msg(e); }
  await db.integrationHealth.upsert({
    where: { tenantId_key: { tenantId: ctx.tenantId, key } },
    create: { tenantId: ctx.tenantId, key, lastTestAt: at, lastTestOk: ok, lastSuccessAt: ok ? at : null, lastError: error, lastErrorAt: ok ? null : at, detail: ok ? detail : null },
    update: { lastTestAt: at, lastTestOk: ok, ...(ok ? { lastSuccessAt: at, lastError: null, lastErrorAt: null, detail } : { lastError: error, lastErrorAt: at }) },
  });
  await writeAudit(db, { tenantId: ctx.tenantId, userId: ctx.userId, userName: ctx.userName, action: `Integration test ${ok ? "passed" : "failed"}`, entity: "integration", entityId: key, detail: ok ? detail.slice(0, 200) : (error ?? "").slice(0, 200) });
  const r = (await healthOverview(ctx, at)).find((x) => x.key === key)!;
  return r;
}

/** Called by the scheduler tick after every run. */
export async function recordHeartbeat(ok: boolean, error?: string) {
  const now = new Date();
  await db.systemHeartbeat.upsert({
    where: { key: "scheduler" },
    create: { key: "scheduler", lastRunAt: now, lastOkAt: ok ? now : null, lastError: ok ? null : (error ?? "failed").slice(0, 300), runs: 1 },
    update: { lastRunAt: now, runs: { increment: 1 }, ...(ok ? { lastOkAt: now, lastError: null } : { lastError: (error ?? "failed").slice(0, 300) }) },
  });
}
