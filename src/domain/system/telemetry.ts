// No "server-only" import: instrumentation's onRequestError loads this module. Defaults match getPrivacy (strict on, both off).
import { createHash } from "node:crypto";
import { db } from "@/server/db";

const VERSION = process.env.npm_package_version ?? "0.1.0";

/** Both the owner's toggle and strict mode off, and a destination configured on the server. */
export async function telemetryAllowed(tenantId: string, kind: "telemetry" | "crash") {
  const url = kind === "telemetry" ? process.env.TELEMETRY_URL : process.env.CRASH_REPORT_URL;
  if (!url) return false;
  const t = await db.tenant.findUnique({ where: { id: tenantId }, select: { settings: true } });
  const p = (t?.settings as { privacy?: { strict?: boolean; telemetry?: boolean; crash?: boolean } } | null)?.privacy ?? {};
  return (p.strict ?? true) === false && p[kind] === true;
}

/** A stable, anonymous install id: not reversible to the pharmacy without the server secret. */
const installId = (tenantId: string) => createHash("sha256").update(`medoro-install:${tenantId}:${process.env.SESSION_SECRET ?? ""}`).digest("hex").slice(0, 24);

/** Counts rounded to a coarse bucket, so the ping can't identify a pharmacy by its exact size. */
export function bucket(n: number) {
  if (n <= 0) return "0";
  for (const b of [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000]) if (n <= b) return `≤${b}`;
  return ">10000";
}

/** The daily anonymous usage ping: version and bucketed counts. No names, numbers, amounts or records. */
export async function usagePayload(tenantId: string, now = new Date()) {
  const since = new Date(now.getTime() - 86400_000);
  const [branches, users, medicines, sales, devices] = await Promise.all([
    db.branch.count({ where: { tenantId, active: true } }), db.user.count({ where: { tenantId, active: true, isSupport: false } }),
    db.medicine.count({ where: { tenantId, active: true } }), db.sale.count({ where: { tenantId, at: { gte: since } } }), db.device.count({ where: { tenantId } }),
  ]);
  return { kind: "usage", v: 1, install: installId(tenantId), version: VERSION, day: now.toISOString().slice(0, 10), counts: { branches: bucket(branches), users: bucket(users), medicines: bucket(medicines), salesLastDay: bucket(sales), devices: bucket(devices) } };
}

export async function sendUsagePing(tenantId: string, now = new Date()) {
  if (!(await telemetryAllowed(tenantId, "telemetry"))) return false;
  const res = await fetch(process.env.TELEMETRY_URL!, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(await usagePayload(tenantId, now)), signal: AbortSignal.timeout(10_000) });
  return res.ok;
}

/** Removes anything that could identify a person, a pharmacy or a credential from error text. */
export function redact(s: string) {
  return s
    .replace(/Bearer\s+[\w.~+/=-]+/gi, "Bearer [redacted]")
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, "[email]")
    .replace(/\b\d{2}[A-Z]{5}\d{4}[A-Z][A-Z\d]Z[A-Z\d]\b/g, "[gstin]")
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "[id]")
    .replace(/(postgres(ql)?|https?):\/\/[^\s'"]+/gi, "$1://[redacted]")
    .replace(/\b[A-Za-z0-9_-]{24,}\b/g, "[token]")
    .replace(/(\+?\d[\d\s-]{5,}\d)/g, "[number]")
    .replace(/"[^"\n]{0,200}"|'[^'\n]{0,200}'|“[^”\n]{0,200}”/g, "[text]");
}

/** Stack frames only (function and file:line), with node_modules frames dropped. */
function frames(stack: string | undefined) {
  return (stack ?? "").split("\n").slice(1).map((l) => l.trim()).filter((l) => l.startsWith("at ") && !l.includes("node_modules")).slice(0, 15).map((l) => redact(l.replace(/\?[^\s)]*/g, "")));
}

let sent: number[] = [];

/** Sends a scrubbed crash report when every pharmacy on this server allows it (single-tenant installs: the owner's choice). */
export async function reportCrash(err: unknown, info: { method?: string; route?: string; kind?: string }) {
  if (!process.env.CRASH_REPORT_URL) return false;
  const now = Date.now();
  sent = sent.filter((t) => now - t < 3600_000);
  if (sent.length >= 20) return false;
  const tenants = await db.tenant.findMany({ select: { id: true } });
  if (!tenants.length) return false;
  for (const t of tenants) if (!(await telemetryAllowed(t.id, "crash"))) return false;
  sent.push(now);
  const e = err instanceof Error ? err : new Error(String(err));
  const body = { kind: "crash", v: 1, version: VERSION, at: new Date(now).toISOString(), name: e.name, message: redact(e.message).slice(0, 300), frames: frames(e.stack), route: info.route ? redact(info.route) : undefined, method: info.method, routeType: info.kind };
  const res = await fetch(process.env.CRASH_REPORT_URL, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(10_000) });
  return res.ok;
}
