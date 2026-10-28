import "server-only";
import { EventEmitter } from "node:events";
import { Client } from "pg";

/**
 * Live change feed. One LISTEN connection per app server receives `medoro_change` notifications
 * from the database triggers (see the live_change_events migration) and fans them out to the
 * browsers connected to /api/events. Works with several app servers because Postgres does the fan-out.
 * LISTEN needs a session connection, so it uses DIRECT_URL when set (a pooler in transaction mode drops it).
 */
export type Change = { t: string; tenant: string | null; branch: string | null };

type Hub = { emitter: EventEmitter; client: Client | null; connecting: Promise<void> | null; retry: number };
const g = globalThis as unknown as { __medoroLive?: Hub };
const hub: Hub = (g.__medoroLive ??= { emitter: new EventEmitter().setMaxListeners(0), client: null, connecting: null, retry: 0 });

async function connect() {
  if (hub.client) return;
  if (hub.connecting) return hub.connecting;
  hub.connecting = (async () => {
    const c = new Client({ connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL });
    c.on("notification", (n) => {
      if (n.channel !== "medoro_change" || !n.payload) return;
      try { const ch = JSON.parse(n.payload) as Change; if (ch.tenant) hub.emitter.emit(ch.tenant, ch); } catch { /* ignore malformed */ }
    });
    const lost = () => {
      if (hub.client !== c) return;
      hub.client = null;
      c.end().catch(() => {});
      const wait = Math.min(30_000, 1000 * 2 ** hub.retry++);
      setTimeout(() => { if (hub.emitter.eventNames().length) connect().catch(() => {}); }, wait);
    };
    c.on("error", lost);
    c.on("end", lost);
    await c.connect();
    await c.query("LISTEN medoro_change");
    hub.client = c; hub.retry = 0;
  })().finally(() => { hub.connecting = null; });
  return hub.connecting;
}

/** Calls `fn` for every committed change in this pharmacy. Returns an unsubscribe function. */
export async function subscribe(tenantId: string, fn: (c: Change) => void) {
  hub.emitter.on(tenantId, fn);
  try { await connect(); } catch (e) { hub.emitter.off(tenantId, fn); throw e; }
  return () => { hub.emitter.off(tenantId, fn); };
}

export const liveConnected = () => !!hub.client;
