import "server-only";
import { z } from "zod";
import { hostClass } from "@/domain/ai/llm";
import { log } from "@/server/log";
import { INTENTS, type Intent } from "./nlu";

// Client for the self-hosted AI service (ai-service/: FastAPI with Faster-Whisper, Piper and Ollama on a separate
// persistent host). There is no paid fallback of any kind: when the service is not configured or not reachable, the
// conversation continues as text with the rule engine, and the screen says voice is unavailable.
//
//   AI_HR_SERVICE_URL    https://ai.example.internal (https required unless the host is loopback or private)
//   AI_HR_SERVICE_TOKEN  shared bearer token (also set on the AI host); never sent to the browser

export type ServiceConfig = { url: string; token: string } | null;
export function serviceConfig(env: NodeJS.ProcessEnv = process.env): ServiceConfig {
  const url = (env.AI_HR_SERVICE_URL ?? "").trim().replace(/\/+$/, ""), token = (env.AI_HR_SERVICE_TOKEN ?? "").trim();
  if (!url || token.length < 24) return null;
  let u: URL;
  try { u = new URL(url); } catch { return null; }
  if (u.protocol !== "https:" && hostClass(u.hostname) === "public") return null; // plain http only on loopback / private networks
  return { url, token };
}

async function call<T>(path: string, init: RequestInit, schema: z.ZodType<T>, timeoutMs: number): Promise<T> {
  const cfg = serviceConfig();
  if (!cfg) throw new Error("AI service not configured");
  const res = await fetch(cfg.url + path, { ...init, headers: { ...(init.headers ?? {}), authorization: `Bearer ${cfg.token}` }, signal: AbortSignal.timeout(timeoutMs), cache: "no-store" });
  if (!res.ok) throw new Error(`AI service ${path} answered ${res.status}`);
  return schema.parse(await res.json());
}

const healthSchema = z.object({
  ok: z.boolean(), llm: z.object({ ok: z.boolean(), model: z.string().optional(), error: z.string().optional() }).partial().optional(),
  stt: z.object({ ok: z.boolean(), model: z.string().optional(), loaded: z.boolean().optional() }).partial().optional(),
  tts: z.object({ ok: z.boolean(), voice: z.string().optional() }).partial().optional(),
  memory: z.object({ total_mb: z.number(), available_mb: z.number(), process_rss_mb: z.number() }).partial().optional(),
  cpu: z.object({ count: z.number(), load1: z.number() }).partial().optional(),
  version: z.string().optional(),
}).passthrough();
export type Health = z.infer<typeof healthSchema> & { configured: boolean; reachable: boolean; error?: string; ms?: number };

export async function health(): Promise<Health> {
  if (!serviceConfig()) return { ok: false, configured: false, reachable: false, error: "AI_HR_SERVICE_URL / AI_HR_SERVICE_TOKEN are not set: voice is off; text conversations use the rule engine." };
  const t0 = Date.now();
  try { return { ...(await call("/health", { method: "GET" }, healthSchema, 5000)), configured: true, reachable: true, ms: Date.now() - t0 }; }
  catch (e) { return { ok: false, configured: true, reachable: false, error: e instanceof Error ? e.message : "unreachable" }; }
}

const sttSchema = z.object({ text: z.string().max(2000), language: z.string().max(10).optional(), ms: z.number().optional(), no_speech: z.boolean().optional() });
/** Speech to text (Faster-Whisper). The audio is not stored anywhere: not here and not on the AI host. */
export async function transcribe(audio: Blob): Promise<{ text: string; language?: string; ms: number }> {
  const fd = new FormData();
  fd.set("audio", audio, "turn.webm");
  const t0 = Date.now();
  const r = await call("/stt", { method: "POST", body: fd }, sttSchema, 30_000);
  return { text: r.no_speech ? "" : r.text.trim(), language: r.language, ms: r.ms ?? Date.now() - t0 };
}

const ttsSchema = z.object({ audio_b64: z.string().max(8_000_000), mime: z.string().default("audio/wav"), ms: z.number().optional() });
/** Text to speech (Piper, Hindi female voice). */
export async function speak(text: string): Promise<{ audio: string; mime: string; ms: number }> {
  const t0 = Date.now();
  const r = await call("/tts", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: text.slice(0, 1200) }) }, ttsSchema, 30_000);
  return { audio: r.audio_b64, mime: r.mime, ms: r.ms ?? Date.now() - t0 };
}

/** Intents a model may suggest. Safety and control intents (stop, human, harassment, emergency…) come from the rules only. */
export const MODEL_INTENTS = ["coming", "absent", "leave_applied", "want_leave", "wfh", "already_checked_in", "attendance_issue", "still_working", "forgot_checkout", "overtime_accept", "overtime_reject", "overtime_clarify", "busy", "yes", "no", "unknown"] as const satisfies readonly Intent[];
const classifySchema = z.object({ intent: z.enum(MODEL_INTENTS), eta: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable().optional(), ms: z.number().optional() });
/**
 * Asks the local model (Ollama via the AI service) to place an utterance the rules couldn't. The answer must validate
 * against a closed list; anything else is ignored. Used only to choose between the engine's own next steps.
 */
export async function classify(utterance: string, callReason: string, question: string): Promise<z.infer<typeof classifySchema> | null> {
  if (!serviceConfig()) return null;
  try {
    return await call("/llm/classify", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ utterance: utterance.slice(0, 500), call_reason: callReason, question: question.slice(0, 300), intents: MODEL_INTENTS }) }, classifySchema, 15_000);
  } catch (e) { log.warn("ai-hr classify failed", { err: e instanceof Error ? e.message : String(e) }); return null; }
}
export const ALL_INTENTS = INTENTS;
