import "server-only";
import { chat, resolveProvider, type Provider } from "@/domain/ai/llm";
import { log } from "@/server/log";

// Makes the Sales Pulse bots read like people: each planned message (a template with real-looking numbers) is a brief
// that the configured AI model rewrites in that bot's own voice. Uses the same AI settings as the rest of Medoro:
//   * a local Ollama model (LOCAL_LLM_URL + LOCAL_LLM_MODEL), or
//   * an OpenAI-compatible API (AI_MODE=remote, REMOTE_AI_URL, REMOTE_AI_MODEL, REMOTE_AI_KEY) once SALES_PULSE_REMOTE_AI=1.
// SALES_PULSE_AI=off turns it off. Without a model, or when the model fails, the template text is posted as it is.
// Nothing personal leaves the server: real colleagues appear to the model only as [colleague] / [new colleague] and
// their first names are put back here.

export type Brief = { key: string; senderId: string; name: string; brief: string; kind: "daily" | "welcome"; newName?: string };

/** A steady personality per bot, so the same person always sounds the same. */
const STYLES = [
  "cheerful and uses lots of emojis",
  "short and to the point, rarely more than one line",
  "a senior who motivates juniors, warm and encouraging",
  "casual, types fast, sometimes skips punctuation",
  "energetic, loves exclamation marks",
  "polite and a bit formal",
  "funny, likes a light joke",
  "competitive, always mentions the target",
  "new to the team (6 months), excited about every win",
  "calm and confident, few emojis",
  "very friendly, often thanks the team",
  "uses Hinglish slang like 'bhai', 'scene set', 'ekdum'",
] as const;
const REGIONS = ["Mumbai", "Delhi", "Bengaluru", "Hyderabad", "Chennai", "Kolkata", "Pune", "Ahmedabad", "Jaipur", "Lucknow", "Kochi", "Indore"] as const;
export function personaStyle(senderId: string) {
  const n = Number(senderId.slice(6)) || 1;
  return { style: STYLES[(n * 7) % STYLES.length], from: REGIONS[(n * 5) % REGIONS.length], years: 1 + ((n * 3) % 6) };
}

export function langOf(text: string): "Hindi (Devanagari script)" | "Hinglish (Hindi in Roman script mixed with English)" | "English" {
  if (/[ऀ-ॿ]/.test(text)) return "Hindi (Devanagari script)";
  if (/\b(aaj|kar|ho gaya|ho gayi|hai|bhai|wale|liya|ka|ke|ko|se|mein|me|chalo|bola|kal|abhi|toh)\b/i.test(text)) return "Hinglish (Hindi in Roman script mixed with English)";
  return "English";
}

const ABOUT = "Medoro is billing and inventory software for Indian pharmacies (chemists). Plans: Starter ₹999/month, Professional ₹2,499/month, Multi-branch ₹4,499/month, plus the AI Pharmacy Manager add-on. Features chemists like: GST billing, expiry alerts, stock tracking, barcode billing, WhatsApp reminders.";

function prompt(b: Brief, recent: string[], win: string | null) {
  const p = personaStyle(b.senderId);
  const sys = [
    `You write one message for the Medoro sales team's group chat, as ${b.name.split(" ")[0]}, a salesperson from ${p.from} with ${p.years} year${p.years > 1 ? "s" : ""} in sales. Personality: ${p.style}.`,
    ABOUT,
    "Write like a real colleague typing on a phone: natural, short (1 or 2 sentences, under 200 characters), no hashtags, no quotation marks, no sign-off, never mention AI or that you were given a brief.",
    `Write in ${langOf(b.brief)}, the same language as the brief.`,
  ];
  if (b.kind === "daily") {
    sys.push("Say what the brief says in your own words. Keep every number, plan name and city exactly as in the brief.");
    if (win) sys.push(`A colleague, [colleague], just posted: "${win}". You may also congratulate [colleague] in a few words, writing [colleague] exactly like that.`);
  } else {
    sys.push("A new colleague just joined the group. Welcome them warmly in your own words. Write their name exactly as [new colleague].");
  }
  if (recent.length) sys.push(`Others already wrote these today, so don't repeat their wording:\n${recent.map((r) => `- ${r}`).join("\n")}`);
  return [{ role: "system" as const, content: sys.join("\n") }, { role: "user" as const, content: b.kind === "daily" ? `Brief: ${b.brief}` : `Brief (an example welcome, write your own): ${b.brief}` }];
}

/** Cleans the model's reply; null when it isn't usable (empty, too long, talks about AI, or lost the name placeholder). */
export function tidy(raw: string, b: Pick<Brief, "kind" | "name">, winBy: string | null): string | null {
  let t = raw.trim().replace(/^```[a-z]*\s*|```$/g, "").trim();
  t = t.replace(new RegExp(`^(${b.name}|${b.name.split(" ")[0]})\\s*:\\s*`, "i"), "").replace(/^["“'](.*)["”']$/s, "$1").trim();
  t = t.split(/\n+/).slice(0, 2).join("\n").trim();
  if (!t || t.length > 300 || /\b(as an ai|language model|brief)\b/i.test(t)) return null;
  if (b.kind === "welcome" && !t.includes("[new colleague]")) return null;
  if (t.includes("[colleague]") && !winBy) return null;
  if (/\[(?!new colleague\]|colleague\])[^\]]*\]/.test(t)) return null; // some other placeholder left in
  return t;
}

const cache = new Map<string, string>();
let provider: Provider | null | undefined;
function model(): Provider | null {
  if (provider !== undefined) return provider;
  if ((process.env.SALES_PULSE_AI ?? "").toLowerCase() === "off") return (provider = null);
  provider = resolveProvider(process.env, { strict: false, remoteAi: process.env.SALES_PULSE_REMOTE_AI === "1" }).provider;
  return provider;
}

/**
 * Rewrites the briefs in each bot's voice. Returns text by key for the ones that worked; the rest keep their template.
 * `recent` are today's earlier bot messages (to avoid repeats); `win` is the latest real win, if one was in the last hour.
 */
export async function humanize(briefs: Brief[], recent: string[], win: { body: string; firstName: string } | null): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const p = model();
  for (const b of briefs) { const c = cache.get(b.key); if (c) out.set(b.key, c); }
  if (!p) return out;
  const todo = briefs.filter((b) => !out.has(b.key)).slice(0, 6); // a handful per tick keeps the tick quick
  await Promise.all(todo.map(async (b) => {
    try {
      const r = await chat(p, prompt(b, recent.slice(-8), win?.body ?? null), [], AbortSignal.timeout(12_000), 0.9);
      const t = tidy(r.content, b, win?.firstName ?? null);
      if (!t) return;
      const text = t.replaceAll("[new colleague]", b.newName ?? "").replaceAll("[colleague]", win?.firstName ?? "");
      cache.set(b.key, text);
      out.set(b.key, text);
    } catch (e) {
      log.error("Sales Pulse AI rewrite failed; using the template.", { err: e });
    }
  }));
  if (cache.size > 500) for (const k of [...cache.keys()].slice(0, cache.size - 500)) cache.delete(k);
  return out;
}
