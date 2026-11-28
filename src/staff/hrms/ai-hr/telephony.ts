import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

// Mode B: real mobile calls through a legitimate SIP/PSTN provider. Nothing here places a call until a provider is
// configured and AI_HR_SIP_ENABLED=1: ordinary Indian mobile numbers can only be reached through a licensed carrier
// connection, which costs money and has legal requirements (consent, calling hours, DLT/TRAI rules) that the company
// must verify first. No SIM gateway or telecom bypass is supported.

export interface TelephonyProvider {
  readonly name: string;
  /** Starts an outbound call that streams audio to the AI service; returns the provider's call id. */
  dial(input: { callId: string; to: string; callbackUrl: string }): Promise<{ providerId: string }>;
}

class NotConfigured implements TelephonyProvider {
  readonly name = "none";
  async dial(): Promise<{ providerId: string }> {
    throw new Error("Mobile calling is not configured. AI conversations happen in the HRMS (browser voice).");
  }
}

export function telephony(env: NodeJS.ProcessEnv = process.env): TelephonyProvider {
  if (env.AI_HR_SIP_ENABLED !== "1" || !env.AI_HR_SIP_PROVIDER) return new NotConfigured();
  // An adapter for a specific provider (e.g. an Asterisk/FreeSWITCH SIP trunk) is added here once one is contracted.
  return new NotConfigured();
}
export const sipEnabled = (env: NodeJS.ProcessEnv = process.env) => env.AI_HR_SIP_ENABLED === "1" && !!env.AI_HR_WEBHOOK_SECRET;

/** Verifies `X-Medoro-Signature: t=<unix>,v1=<hex hmac-sha256 of "t.body">` within five minutes. */
export function verifySignature(header: string | null, body: string, secret: string, now = Date.now()): boolean {
  if (!header || !secret) return false;
  const parts = Object.fromEntries(header.split(",").map((p) => p.trim().split("=") as [string, string]));
  const t = Number(parts.t), v1 = parts.v1 ?? "";
  if (!Number.isFinite(t) || Math.abs(now / 1000 - t) > 300 || !/^[0-9a-f]{64}$/.test(v1)) return false;
  const want = createHmac("sha256", secret).update(`${t}.${body}`).digest();
  return timingSafeEqual(want, Buffer.from(v1, "hex"));
}
export const sign = (body: string, secret: string, t = Math.floor(Date.now() / 1000)) => `t=${t},v1=${createHmac("sha256", secret).update(`${t}.${body}`).digest("hex")}`;
