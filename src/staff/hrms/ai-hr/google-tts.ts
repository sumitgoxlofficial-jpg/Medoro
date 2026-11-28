import "server-only";
import { z } from "zod";
import { db } from "@/server/db";
import { log } from "@/server/log";

// Naina's natural voice from Google Cloud Text-to-Speech (Neural2 / Chirp 3 HD). Only the text of her reply is sent to
// Google (never the employee's voice or name beyond what she says), with an API key that stays on the server
// (GOOGLE_TTS_API_KEY). A monthly character limit keeps use inside Google's free allowance: past it, phones use their
// own voice until the next month. docs/OFFICE_SERVER.md §10d has the set-up steps.

/** Female voices offered in Settings. Chirp 3 HD sounds most human; Neural2 is the dependable fallback. */
export const GOOGLE_VOICES = {
  "hi-IN-Chirp3-HD-Kore": "Chirp 3 HD · Kore (most natural)",
  "hi-IN-Chirp3-HD-Aoede": "Chirp 3 HD · Aoede (most natural)",
  "hi-IN-Neural2-A": "Neural2 · A",
  "hi-IN-Neural2-D": "Neural2 · D",
} as const;
export type GoogleVoice = keyof typeof GOOGLE_VOICES;
const FALLBACK: GoogleVoice = "hi-IN-Neural2-A";

export const googleKey = (env: NodeJS.ProcessEnv = process.env) => (env.GOOGLE_TTS_API_KEY ?? "").trim();
/** External speech is off unless the deployment opts in (AI_HR_ALLOW_EXTERNAL_TTS=1): Medoro's own voice is Kokoro, self-hosted. */
export const externalTtsAllowed = (env: NodeJS.ProcessEnv = process.env) => env.AI_HR_ALLOW_EXTERNAL_TTS === "1";
export const googleConfigured = () => externalTtsAllowed() && googleKey().length >= 20;

const usageKey = (d = new Date()) => `aiHrTtsUsage:${d.toISOString().slice(0, 7)}`;
export async function monthUsage(d = new Date()): Promise<number> {
  const v = (await db.hrSetting.findUnique({ where: { key: usageKey(d) } }))?.value as { chars?: number } | undefined;
  return v?.chars ?? 0;
}
async function addUsage(chars: number, d = new Date()) {
  await db.$executeRaw`
    INSERT INTO "HrSetting" (key, value) VALUES (${usageKey(d)}, jsonb_build_object('chars', ${chars}::int))
    ON CONFLICT (key) DO UPDATE SET value = jsonb_build_object('chars', COALESCE(("HrSetting".value->>'chars')::int, 0) + ${chars}::int)`;
}

const out = z.object({ audioContent: z.string().min(1).max(8_000_000) });
/** The voice for the script of the text: Hindi voices read Devanagari; English (and Hinglish in Latin letters) uses en-IN. */
function voiceFor(text: string, chosen: GoogleVoice) {
  if (/[ऀ-ॿ]/.test(text)) return { languageCode: "hi-IN", name: chosen };
  return { languageCode: "en-IN", name: chosen.includes("Chirp3-HD") ? chosen.replace("hi-IN", "en-IN") : "en-IN-Neural2-A" };
}
const clean = (t: string) => t.replace(/\(([^)]*Source|स्रोत)[^)]*\)/g, "").replace(/\s+/g, " ").trim().slice(0, 1500);

/**
 * Speaks `text` with Google's natural voice. Returns null (so the device's voice is used) when no key is set, the
 * monthly limit is reached, or Google refuses; a voice name Google doesn't know falls back to Neural2 once.
 */
export async function googleSpeak(text: string, chosen: GoogleVoice, monthlyLimit: number): Promise<{ audio: string; mime: string; ms: number } | null> {
  const key = googleKey(), t = clean(text);
  if (!googleConfigured() || !t) return null;
  if ((await monthUsage()) + t.length > monthlyLimit) return null;
  const t0 = Date.now();
  const ask = async (voice: { languageCode: string; name: string }) => fetch(`https://texttospeech.googleapis.com/v1/text:synthesize`, {
    method: "POST", cache: "no-store", signal: AbortSignal.timeout(10_000),
    headers: { "content-type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify({ input: { text: t }, voice, audioConfig: { audioEncoding: "MP3", sampleRateHertz: 24000 } }),
  });
  try {
    let res = await ask(voiceFor(t, chosen));
    if (res.status === 400 && chosen !== FALLBACK) res = await ask(voiceFor(t, FALLBACK)); // voice not available: the dependable one
    if (!res.ok) { log.warn("google tts refused", { status: res.status, body: (await res.text()).slice(0, 300) }); return null; }
    const r = out.parse(await res.json());
    await addUsage(t.length).catch(() => {});
    return { audio: r.audioContent, mime: "audio/mpeg", ms: Date.now() - t0 };
  } catch (e) {
    log.warn("google tts failed", { err: e instanceof Error ? e.message : String(e) });
    return null;
  }
}
