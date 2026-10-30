import { UserError } from "@/server/action";

export const GRAPH_VERSION = () => process.env.WA_GRAPH_VERSION || "v26.0";
export const GRAPH = () => `https://graph.facebook.com/${GRAPH_VERSION()}`;

/**
 * How a failed send should be handled. retry: temporary (throughput, Meta outage, network), sent again
 * with backoff. invalid: the recipient isn't reachable on WhatsApp, so the number is flagged. auth: the
 * access token was revoked or expired, so the integration is disconnected. permanent: never retried.
 */
export type FailKind = "retry" | "permanent" | "invalid" | "auth";

const RETRY = new Set([1, 2, 4, 17, 341, 80007, 130429, 131000, 131016, 131056, 131057, 133004, 2494100]);
const AUTH = new Set([0, 102, 190, 463, 467]);
const INVALID = new Set([131026]);

export function classify(code: number | undefined, http?: number): FailKind {
  if (code !== undefined) return AUTH.has(code) ? "auth" : INVALID.has(code) ? "invalid" : RETRY.has(code) ? "retry" : "permanent";
  if (http === 401) return "auth";
  return http === undefined || http >= 500 || http === 429 ? "retry" : "permanent";
}

const REASON: Record<number, string> = {
  130429: "WhatsApp throughput limit reached; will retry",
  131056: "Too many messages to this number in a short time; will retry",
  131026: "This number isn’t on WhatsApp (or can’t receive business messages)",
  131047: "More than 24 hours since the customer last replied; only templates can be sent",
  131050: "The customer stopped marketing messages from you on WhatsApp",
  131049: "Meta held this marketing message back to limit how many the customer gets",
  130403: "You blocked this customer on WhatsApp",
  131042: "Meta billing problem: add or fix the payment method in WhatsApp Manager",
  131045: "Your business number isn’t registered with Cloud API",
  132000: "The template’s variable count doesn’t match",
  132001: "The template doesn’t exist in this language or isn’t approved",
  132007: "The template breaks a WhatsApp policy",
  132012: "A template variable is in the wrong format",
  132015: "The template is paused for low quality",
  132016: "The template was disabled for low quality",
  190: "Meta access token expired or was revoked",
};

export class GraphError extends UserError {
  constructor(message: string, readonly code: number | undefined, readonly kind: FailKind, readonly http?: number) { super(message); }
  /** Short reason for the delivery log. */
  get reason() { return (this.code !== undefined && REASON[this.code] ? `${REASON[this.code]} (${this.code})` : this.message).slice(0, 200); }
}

type GraphErr = { error?: { message?: string; code?: number; error_data?: { details?: string } } };

/** A Graph API call. Errors become GraphError with Meta's code and how to treat it. */
export async function graph<T>(path: string, token: string | null, init?: RequestInit): Promise<T> {
  let r: Response;
  try {
    r = await fetch(path.startsWith("https://") ? path : `${GRAPH()}${path}`, { ...init, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(init?.headers ?? {}) }, signal: AbortSignal.timeout(20_000) });
  } catch (e) {
    throw new GraphError(`Meta: couldn’t reach Meta (${(e as Error).name})`, undefined, "retry");
  }
  const j = (await r.json().catch(() => ({}))) as T & GraphErr;
  if (!r.ok || j.error) {
    const e = j.error ?? {};
    const detail = e.error_data?.details && !e.message?.includes(e.error_data.details) ? ` ${e.error_data.details}` : "";
    throw new GraphError(`Meta: ${e.message ?? `HTTP ${r.status}`}${detail}`.slice(0, 300), e.code, classify(e.code, r.status), r.status);
  }
  return j;
}

/** Kind of an error reported later in a webhook status (no HTTP status there). */
export const webhookKind = (code: number | undefined): FailKind => (code === undefined ? "permanent" : classify(code, 400));
export const reasonFor = (code: number | undefined, title?: string) => (code !== undefined && REASON[code] ? `${REASON[code]} (${code})` : `${title ?? "Failed"}${code !== undefined ? ` (${code})` : ""}`).slice(0, 200);
