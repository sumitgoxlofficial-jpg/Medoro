import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import { db } from "./db";
import { liveConnected } from "./live";

type Counters = { http: Map<string, number>; actions: Map<string, number>; started: number };
const g = globalThis as unknown as { __medoroMetrics?: Counters };
const c: Counters = (g.__medoroMetrics ??= { http: new Map(), actions: new Map(), started: Date.now() });

const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);

/** Counts a handled API request by route group and status class (2xx, 4xx…). */
export function countRequest(group: string, status: number) {
  bump(c.http, `${group}|${Math.floor(status / 100)}xx`);
}

export function countAction(outcome: "ok" | "user_error" | "error") {
  bump(c.actions, outcome);
}

/** Wraps a route handler so every response is counted under `group`; thrown errors count as 5xx. */
export function counted<A extends unknown[]>(group: string, handler: (...a: A) => Promise<Response>) {
  return async (...a: A) => {
    try {
      const r = await handler(...a);
      countRequest(group, r.status);
      return r;
    } catch (e) {
      countRequest(group, 500);
      throw e;
    }
  };
}

const esc = (v: string) => v.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
const labels = (o: Record<string, string>) => "{" + Object.entries(o).map(([k, v]) => `${k}="${esc(v)}"`).join(",") + "}";

/** Bearer METRICS_TOKEN (16+ chars). Without the variable the endpoint is disabled. */
export function metricsAuthorized(req: Request) {
  const want = process.env.METRICS_TOKEN ?? "";
  if (want.length < 16) return false;
  const got = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const h = (s: string) => createHash("sha256").update(s).digest();
  return timingSafeEqual(h(got), h(want));
}

export async function renderMetrics(): Promise<string> {
  const out: string[] = [];
  const metric = (name: string, type: "counter" | "gauge", help: string, rows: [Record<string, string>, number][]) => {
    out.push(`# HELP ${name} ${help}`, `# TYPE ${name} ${type}`);
    for (const [l, v] of rows) out.push(`${name}${Object.keys(l).length ? labels(l) : ""} ${Number.isFinite(v) ? v : 0}`);
  };
  metric("medoro_up", "gauge", "1 while the app process serves requests.", [[{}, 1]]);
  metric("medoro_process_start_time_seconds", "gauge", "Process start time (unix seconds).", [[{}, Math.floor(c.started / 1000)]]);
  metric("medoro_process_resident_memory_bytes", "gauge", "Resident set size.", [[{}, process.memoryUsage().rss]]);
  metric("medoro_http_requests_total", "counter", "API requests handled by this process, by route group and status class.",
    [...c.http].map(([k, v]) => { const [group, status] = k.split("|"); return [{ group, status }, v]; }));
  metric("medoro_server_actions_total", "counter", "Server actions run by this process, by outcome.", [...c.actions].map(([k, v]) => [{ outcome: k }, v]));
  metric("medoro_live_listener_connected", "gauge", "1 when the Postgres LISTEN connection for live updates is open.", [[{}, liveConnected() ? 1 : 0]]);

  let dbUp = 1;
  try {
    const [tenants, sales, backups, queue] = await Promise.all([
      db.tenant.findMany({ select: { id: true, code: true } }),
      db.sale.groupBy({ by: ["tenantId", "provisional"], _count: { _all: true } }),
      db.backupManifest.groupBy({ by: ["tenantId"], where: { status: "verified" }, _max: { finishedAt: true } }),
      db.offlineOp.groupBy({ by: ["tenantId", "status"], where: { status: { in: ["pending", "conflict"] } }, _count: { _all: true } }),
    ]);
    const code = new Map(tenants.map((t) => [t.id, t.code]));
    const tc = (id: string) => code.get(id) ?? "unknown";
    metric("medoro_sales_committed_total", "counter", "Committed sale invoices in the database (provisional = posted from an offline counter).",
      sales.map((s) => [{ tenant: tc(s.tenantId), provisional: String(s.provisional) }, s._count._all]));
    metric("medoro_backup_last_success_timestamp_seconds", "gauge", "Finish time of the latest verified backup (unix seconds), 0 if none.",
      tenants.map((t) => { const b = backups.find((x) => x.tenantId === t.id)?._max.finishedAt; return [{ tenant: t.code }, b ? Math.floor(b.getTime() / 1000) : 0]; }));
    metric("medoro_offline_queue_size", "gauge", "Offline counter operations waiting to post or needing review.",
      tenants.flatMap((t) => (["pending", "conflict"] as const).map((st) => [{ tenant: t.code, status: st }, queue.find((q) => q.tenantId === t.id && q.status === st)?._count._all ?? 0] as [Record<string, string>, number])));
  } catch {
    dbUp = 0;
  }
  metric("medoro_database_up", "gauge", "1 when the metrics queries reached the database.", [[{}, dbUp]]);
  return out.join("\n") + "\n";
}
