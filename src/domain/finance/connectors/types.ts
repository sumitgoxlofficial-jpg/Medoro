/**
 * The contract every bank / Account Aggregator / payment-provider adapter implements. An adapter is added only for a
 * provider Medoro has a signed agreement with, built from that provider's documentation (plan, sections 3 and 7).
 * Adapters never see a person's banking password, UPI PIN or OTP: they start the provider's own authorisation (a
 * redirect) and act on what the provider sends back.
 */
import type { SourceLabel } from "../providers";

export type ConnectionKind = "bank" | "aa" | "provider";

/** One transaction exactly as the source sent it, mapped to the fields Medoro uses. Missing fields stay null. */
export type SourceRecord = {
  /** The source's own id for this transaction (stable across fetches). */
  sourceRef: string;
  direction: "credit" | "debit";
  amountPaise: number;
  currency: string;
  /** yyyy-mm-dd as the source books it; time when it gives one. */
  date: string;
  time: string | null;
  description: string;
  utr: string | null;
  bankRef: string | null;
  counterpartyName: string | null;
  counterpartyVpa: string | null;
  status: "success" | "pending" | "failed" | "reversed";
  /** Which account (masked) this belongs to, as the source names it. */
  accountMasked: string | null;
};

/** What a Drive counter receives, sealed for it: one connection's records. */
export type FinBatch = { connectionId: string; connector: string; name: string; accountMasked: string; records: SourceRecord[] };

export type Capabilities = {
  /** Real-time notifications (webhooks) exist. */
  webhook: boolean;
  /** Shortest polling interval the provider allows, in minutes; null if it can't be polled. */
  minPollMin: number | null;
  /** How far back the first fetch may go, in days. */
  historyDays: number;
  /** Consent-based (Account Aggregator style): has an expiry and can be renewed. */
  consent: boolean;
};

export type StartResult = { redirectUrl: string; externalId?: string | null };
export type CallbackResult =
  | { ok: true; displayName: string; accountMasked: string; secret?: unknown; config?: Record<string, unknown>; consentExpiresAt?: Date | null; externalId?: string | null }
  | { ok: false; reason: "denied" | "failed"; message: string };
export type FetchResult = { records: SourceRecord[]; cursor: unknown; more: boolean };

export interface ConnectorAdapter {
  start(i: { connectionId: string; state: string; returnUrl: string }): Promise<StartResult>;
  /** Only this may turn a connection active: the provider confirmed the authorisation. */
  callback(params: URLSearchParams): Promise<CallbackResult>;
  fetch(i: { secret: unknown; config: Record<string, unknown>; cursor: unknown; since: Date }): Promise<FetchResult>;
  refreshConsent?(i: { secret: unknown; config: Record<string, unknown>; state: string; returnUrl: string }): Promise<StartResult>;
  revoke(i: { secret: unknown; config: Record<string, unknown> }): Promise<void>;
  /** Checks a webhook's signature with the connection's secret; null = refuse. */
  verifyWebhook?(i: { raw: string; headers: Headers; secret: unknown; config: Record<string, unknown> }): Promise<SourceRecord[] | null>;
}

export type ConnectorDef = {
  id: string;
  kind: ConnectionKind;
  name: string;
  /** Matches providers.ts SOURCES. */
  sourceId: string;
  label: SourceLabel;
  capabilities: Capabilities;
  /** Null until a partner agreement and its adapter exist. */
  adapter: ConnectorAdapter | null;
};

/** Errors an adapter throws; the sync engine decides retry vs stop from the type. */
export class ConnectorError extends Error {
  constructor(message: string, readonly code: string) { super(message); }
}
/** Too many requests: try again after `retryAfterSec`. */
export class RateLimited extends ConnectorError { constructor(readonly retryAfterSec: number) { super("The provider asked Medoro to slow down.", "rate_limited"); } }
/** The authorisation or consent is no longer valid: stop until the pharmacy reconnects. */
export class AuthFailed extends ConnectorError { constructor(message = "The provider no longer accepts this connection. Connect again.") { super(message, "auth"); } }
export class ConsentExpired extends ConnectorError { constructor() { super("Your consent has expired. Renew it to keep syncing.", "consent_expired"); } }
export class ConsentRevoked extends ConnectorError { constructor() { super("Your consent was revoked at the provider.", "consent_revoked"); } }
/** The provider is down or timed out: retry with backoff. */
export class Unavailable extends ConnectorError { constructor(message = "The provider is not answering right now.") { super(message, "unavailable"); } }
