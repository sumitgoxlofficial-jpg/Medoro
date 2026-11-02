import "server-only";
import { db } from "@/server/db";
import { seal, unseal } from "@/server/vault";
import type { FailKind } from "./graph";
import { embeddedLogout, embeddedResults, embeddedSend, embeddedStatus, NOT_LINKED_HERE, resumeEmbeddedWhatsApp } from "./embedded";

// Two ways to hold the pharmacy's WhatsApp link, as in FITRON for Windows:
//  - built in (embedded.ts): Medoro's own server keeps the link. Used when no connector is set and the server keeps
//    running (self-hosted, Docker, the pharmacy's own computer). Not on Vercel, where the server stops between requests.
//  - a connector (below), when WA_CONNECTOR_URL and WA_CONNECTOR_KEY are set.
//
// Client for the WhatsApp connector (the same service Fitron uses: fitron/whatsapp-connector). It keeps one WhatsApp Web
// link per business: the pharmacy scans a QR code from WhatsApp › Linked devices on its own phone, and Medoro then sends
// bills and reminders from that phone's number. No Meta account is needed.
//
// One connector deployment serves every pharmacy. WA_CONNECTOR_URL is its address and WA_CONNECTOR_KEY its master key
// (WA_CONNECTOR_MASTER_KEY on the connector), used only to create the pharmacy on the connector the first time. After
// that Medoro calls it with the pharmacy's own key, sealed with HOST_KEY in Integration "wa_connector".

const KIND = "wa_connector";
const env = (k: string) => process.env[k]?.trim() || "";
const baseUrl = () => env("WA_CONNECTOR_URL").replace(/\/+$/, "");
const masterKey = () => env("WA_CONNECTOR_KEY");

/** The link is held by Medoro itself (embedded.ts): no connector set, and a server that keeps running. WA_BUILTIN=0 turns it off. */
export const builtIn = () => !baseUrl() && !masterKey() && !process.env.VERCEL && process.env.WA_BUILTIN !== "0";

/** Why linking a phone can't start on this server, or null when it can (built in, or a connector configured). */
export function connectorMissing(): string | null {
  if (builtIn()) return null;
  if (!baseUrl() && !masterKey() && process.env.VERCEL) return "Linking a phone needs Medoro running on a server that stays on (your own computer or server, like FITRON for Windows). This online server stops between visits, so it can’t keep WhatsApp linked. Alternatively set WA_CONNECTOR_URL and WA_CONNECTOR_KEY to use a WhatsApp connector.";
  if (!baseUrl() || !masterKey()) return "The WhatsApp connector isn’t set up on this server. Set WA_CONNECTOR_URL (its https address) and WA_CONNECTOR_KEY (its master key), then restart Medoro.";
  if (!/^https?:\/\//i.test(baseUrl())) return "WA_CONNECTOR_URL must start with https:// (or http:// on the same machine).";
  return null;
}

/** An error the connector answered with: { success: false, error: { code, message } }. */
export class ConnectorError extends Error {
  constructor(readonly code: string, message: string, readonly status: number) {
    super(message);
    this.name = "ConnectorError";
  }
}

/** Why a call to the connector failed, in words an owner can act on. */
export function connectorProblem(e: unknown): string {
  if (e instanceof ConnectorError) return e.message;
  const msg = e instanceof Error ? e.message : String(e);
  if (e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError")) return "The WhatsApp connector didn’t answer in time. Try again in a moment.";
  const code = (e as { cause?: { code?: string } })?.cause?.code;
  if (code || /fetch failed/i.test(msg)) return `Nothing is answering at ${baseUrl() || "WA_CONNECTOR_URL"}. Check that the WhatsApp connector is running.`;
  return msg;
}

/** How Medoro's delivery worker should treat a failed send. */
export function connectorFailKind(e: unknown): FailKind {
  if (!(e instanceof ConnectorError)) return "retry";
  if (["WHATSAPP_NOT_CONNECTED", "SESSION_EXPIRED", "QR_EXPIRED", "GYM_SUSPENDED"].includes(e.code)) return "auth";
  if (e.code === "NUMBER_NOT_ON_WHATSAPP") return "invalid";
  if (["MESSAGE_QUEUE_FULL", "RATE_LIMIT_EXCEEDED", "SERVICE_UNAVAILABLE", "INTERNAL_ERROR", "WHATSAPP_SEND_FAILED"].includes(e.code) || e.status >= 500 || e.status === 429) return "retry";
  return "permanent";
}

type ApiResponse<T> = { success: true; data: T } | { success: false; error?: { code?: string; message?: string } };
type Init = { method: "GET" | "POST"; body?: unknown; timeout?: number };

async function call<T>(path: string, key: string, init: Init): Promise<T> {
  const form = init.body instanceof FormData;
  const res = await fetch(`${baseUrl()}${path}`, {
    method: init.method,
    headers: { Authorization: `Bearer ${key}`, ...(init.body !== undefined && !form ? { "Content-Type": "application/json" } : {}) },
    body: init.method === "POST" ? (form ? (init.body as FormData) : JSON.stringify(init.body ?? {})) : undefined,
    signal: AbortSignal.timeout(init.timeout ?? 15_000),
  });
  const json = (await res.json().catch(() => ({}))) as ApiResponse<T>;
  if (!res.ok || !json.success) {
    const err = (json as { error?: { code?: string; message?: string } }).error;
    let message = err?.message ?? `The WhatsApp connector answered ${res.status}.`;
    if (res.status === 401 && key === masterKey()) message = "The WhatsApp connector refused WA_CONNECTOR_KEY. It must be the connector’s WA_CONNECTOR_MASTER_KEY.";
    throw new ConnectorError(err?.code ?? (res.status === 401 ? "INVALID_API_KEY" : `HTTP_${res.status}`), message, res.status);
  }
  return json.data;
}

type Business = { gymId: string; apiKey: string };

async function stored(tenantId: string): Promise<Business | null> {
  const i = await db.integration.findUnique({ where: { tenantId_kind: { tenantId, kind: KIND } } });
  if (!i?.encryptedSecret) return null;
  try {
    return { gymId: (i.config as { gymId: string }).gymId, apiKey: unseal(i.encryptedSecret).toString() };
  } catch {
    return null;
  }
}

async function save(tenantId: string, b: Business) {
  const data = { config: { gymId: b.gymId }, encryptedSecret: new Uint8Array(seal(b.apiKey)), connectedAt: new Date(), rotatedAt: new Date() };
  await db.integration.upsert({ where: { tenantId_kind: { tenantId, kind: KIND } }, create: { tenantId, kind: KIND, ...data }, update: data });
}

/** The connector knows a pharmacy by this, so the same deployment can also serve Fitron gyms without clashes. */
const externalId = (tenantId: string) => `medoro:${tenantId}`;

/** The pharmacy's own connector key, creating the pharmacy on the connector on first use (or taking it over with a new key). */
async function ensureBusiness(tenantId: string, name?: string): Promise<Business> {
  const have = await stored(tenantId);
  if (have) return have;
  const master = <T,>(path: string, method: "GET" | "POST", body?: unknown) => call<T>(path, masterKey(), { method, body });
  const byExternal = () => master<{ gymId: string }>(`/api/v1/gyms/by-external/${encodeURIComponent(externalId(tenantId))}`, "GET");
  const existing = await byExternal().catch((e) => { if (e instanceof ConnectorError && e.status === 404) return null; throw e; });
  let b: Business;
  if (existing) b = await master<Business>(`/api/v1/gyms/${existing.gymId}/rotate-key`, "POST");
  else {
    try {
      b = await master<Business>("/api/v1/gyms", "POST", { name: (name?.trim() || "Medoro pharmacy").slice(0, 120), externalId: externalId(tenantId) });
    } catch (e) {
      // Two requests created it at once: the other one won, so take it over with a fresh key.
      if (!(e instanceof ConnectorError && (e.code === "DUPLICATE_REQUEST" || e.code === "CONFLICT"))) throw e;
      b = await master<Business>(`/api/v1/gyms/${(await byExternal()).gymId}/rotate-key`, "POST");
    }
  }
  await save(tenantId, { gymId: b.gymId, apiKey: b.apiKey });
  return b;
}

/** A call for one pharmacy with its own key. A key the connector no longer accepts is replaced once and the call retried. */
async function businessCall<T>(tenantId: string, path: string, init: Init & { name?: string }): Promise<T> {
  const b = await ensureBusiness(tenantId, init.name);
  try {
    return await call<T>(path, b.apiKey, init);
  } catch (e) {
    if (!(e instanceof ConnectorError && e.status === 401)) throw e;
    await db.integration.deleteMany({ where: { tenantId, kind: KIND } });
    return call<T>(path, (await ensureBusiness(tenantId, init.name)).apiKey, init);
  }
}

const to = (phone: string) => "+91" + phone.replace(/\D/g, "").slice(-10);

export type LinkState = { state: "ready" | "qr" | "starting" | "reconnecting" | "disconnected"; number?: string; qr?: string; error?: string | null; sentToday?: number; cap?: number };
type StatusData = { status: string; phone: string | null; error: string | null; workerRunning: boolean; today?: { sent: number }; limits?: { perDay: number } };

/**
 * The phone link and, while it waits for a scan, the QR code (a data URL). With `start`, a pharmacy that isn't linked is
 * asked to connect, so a QR comes up; without it the state is only read.
 */
export async function linkState(tenantId: string, opts: { start?: boolean; name?: string } = {}): Promise<LinkState> {
  if (builtIn()) {
    const e = await embeddedStatus(tenantId, { start: opts.start });
    return { state: e.state, number: e.number, qr: e.qr, error: e.error, sentToday: e.sentToday, cap: e.cap };
  }
  const d = await businessCall<StatusData>(tenantId, "/api/v1/whatsapp/status", { method: "GET", timeout: 10_000, name: opts.name });
  const base = { number: d.phone?.replace(/\D/g, "") || undefined, sentToday: d.today?.sent ?? 0, cap: d.limits?.perDay, error: d.error };
  switch (d.status) {
    case "CONNECTED":
      return { state: "ready", ...base, error: null };
    case "QR_REQUIRED":
    case "CONNECTING": {
      const qr = await businessCall<{ qr: string | null }>(tenantId, "/api/v1/whatsapp/qr", { method: "GET", timeout: 10_000 }).catch(() => null);
      return qr?.qr ? { state: "qr", ...base, qr: qr.qr } : { state: "starting", ...base };
    }
    case "RECONNECTING":
      return { state: "reconnecting", ...base };
    default:
      if (!opts.start) return { state: "disconnected", ...base };
      if (!d.workerRunning) return { state: "starting", ...base, error: "The connector’s WhatsApp worker isn’t running." };
      await businessCall(tenantId, "/api/v1/whatsapp/connect", { method: "POST", timeout: 10_000 });
      return { state: "starting", ...base, error: null };
  }
}

/** Signs the phone out on the connector. Errors are ignored: Medoro forgets the link either way. */
export async function unlinkPhone(tenantId: string) {
  if (builtIn()) return embeddedLogout(tenantId);
  if (connectorMissing()) return;
  await businessCall(tenantId, "/api/v1/whatsapp/disconnect", { method: "POST", body: { logout: true }, timeout: 10_000 }).catch(() => {});
}

type Sent = { messageId: string; status: string };
export type PhoneSend = { tenantId: string; phone: string; text: string; key: string; marketing?: boolean; pdf?: { bytes: Uint8Array; filename: string } };

/**
 * Hands one message to the connector, which sends it from the linked phone in a paced queue. Returns the connector's
 * message id; the final status (sent, delivered, read, failed) is fetched later by phoneResults.
 */
export async function sendFromPhone(m: PhoneSend): Promise<string> {
  if (builtIn()) {
    const id = embeddedSend(m.tenantId, { localId: m.key, to: to(m.phone).replace(/\D/g, ""), body: m.text, pdf: m.pdf });
    if (!id) throw new ConnectorError("WHATSAPP_NOT_CONNECTED", NOT_LINKED_HERE, 409);
    return id;
  }
  const category = m.marketing ? "MARKETING" : "TRANSACTIONAL";
  // Medoro has already checked the customer's consent; the connector keeps its own list and wants an opt-in for marketing.
  if (m.marketing) await businessCall(m.tenantId, "/api/v1/consent/opt-in", { method: "POST", body: { phone: to(m.phone), source: "medoro" } });
  if (m.pdf) {
    const form = new FormData();
    form.append("to", to(m.phone));
    form.append("caption", m.text.slice(0, 1024));
    form.append("idempotencyKey", m.key);
    form.append("category", category);
    form.append("file", new Blob([new Uint8Array(m.pdf.bytes)], { type: "application/pdf" }), m.pdf.filename);
    return (await businessCall<Sent>(m.tenantId, "/api/v1/messages/document", { method: "POST", body: form, timeout: 30_000 })).messageId;
  }
  return (await businessCall<Sent>(m.tenantId, "/api/v1/messages/send", { method: "POST", body: { to: to(m.phone), message: m.text, idempotencyKey: m.key, category } })).messageId;
}

const STATUS: Record<string, "queued" | "sent" | "delivered" | "read" | "failed"> = { QUEUED: "queued", PROCESSING: "queued", SENT: "sent", DELIVERED: "delivered", READ: "read", FAILED: "failed", CANCELLED: "failed" };

/** Where the connector's messages stand, by its message id. null when it can't be reached. */
export async function phoneResults(tenantId: string, ids: string[]): Promise<Record<string, { status: string; error: string | null }> | null> {
  if (!ids.length) return {};
  if (builtIn()) {
    const out: Record<string, { status: string; error: string | null }> = {};
    for (const [k, r] of Object.entries(embeddedResults(tenantId, ids))) out[k] = { status: r.status.toLowerCase(), error: r.error ?? null };
    return out;
  }
  if (connectorMissing()) return null;
  const out: Record<string, { status: string; error: string | null }> = {};
  try {
    for (let i = 0; i < ids.length; i += 100) {
      const r = await businessCall<{ items: { messageId: string; status: string; error: string | null }[] }>(tenantId, `/api/v1/messages?ids=${encodeURIComponent(ids.slice(i, i + 100).join(","))}&limit=200`, { method: "GET" });
      for (const m of r.items) out[m.messageId] = { status: STATUS[m.status] ?? "queued", error: m.status === "CANCELLED" ? "Cancelled on the connector" : m.error };
    }
    return out;
  } catch {
    return null;
  }
}

/** From the scheduler: reconnects pharmacies whose phone is linked on this server (after a restart). */
export function resumeBuiltIn() {
  if (builtIn()) resumeEmbeddedWhatsApp();
}
