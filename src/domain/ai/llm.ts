/**
 * Model providers for the assistant: a local Ollama server or an OpenAI-compatible remote endpoint.
 * Pure apart from fetch, so it can be unit-tested with a stubbed fetch.
 */

export type AiMode = "rules" | "local" | "remote";
export type Provider = { kind: "local" | "remote"; dialect: "ollama" | "openai"; url: string; model: string; key?: string };
export type HostClass = "loopback" | "private" | "public";

/** loopback = this machine; private = RFC 1918 / ULA / link-local; anything else (including DNS names) is public. */
export function hostClass(raw: string): HostClass {
  let h: string;
  try { h = new URL(raw).hostname.toLowerCase().replace(/^\[|\]$/g, ""); } catch { return "public"; }
  if (h === "localhost" || h.endsWith(".localhost") || h === "::1") return "loopback";
  const v4 = (h.startsWith("::ffff:") ? h.slice(7) : h).match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const [a, b] = [+v4[1], +v4[2]];
    if (a === 127) return "loopback";
    if (a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254)) return "private";
    return "public";
  }
  if (/^f[cd][0-9a-f]{2}:/.test(h) || /^fe[89ab][0-9a-f]:/.test(h)) return "private";
  return "public";
}

type Env = Record<string, string | undefined>;

/**
 * Which model (if any) may plan this pharmacy's questions. Strict mode allows only a model on this machine.
 * A "local" URL that isn't loopback or a private address is treated as remote and needs the owner's opt-in.
 */
export function resolveProvider(env: Env, privacy: { strict: boolean; remoteAi: boolean }): { provider: Provider | null; mode: AiMode; note?: string } {
  const wanted = (env.AI_MODE ?? "").toLowerCase().replace(/s$/, "") || (env.LOCAL_LLM_URL && env.LOCAL_LLM_MODEL ? "local" : "rule");
  if (wanted === "rule") return { provider: null, mode: "rules" };
  const remoteAllowed = () => privacy.strict ? "Strict mode keeps AI on this server, so the remote model is off." : !privacy.remoteAi ? "The owner hasn’t allowed a remote AI provider." : null;
  if (wanted === "local") {
    if (!env.LOCAL_LLM_URL || !env.LOCAL_LLM_MODEL) return { provider: null, mode: "rules", note: "No local model is configured." };
    const cls = hostClass(env.LOCAL_LLM_URL);
    if (privacy.strict && cls !== "loopback") return { provider: null, mode: "rules", note: "Strict mode allows only a model on this server (localhost)." };
    if (cls === "public") {
      const no = remoteAllowed();
      if (no) return { provider: null, mode: "rules", note: no };
      return { provider: { kind: "remote", dialect: "ollama", url: env.LOCAL_LLM_URL, model: env.LOCAL_LLM_MODEL }, mode: "remote" };
    }
    return { provider: { kind: "local", dialect: "ollama", url: env.LOCAL_LLM_URL, model: env.LOCAL_LLM_MODEL }, mode: "local" };
  }
  if (wanted === "remote") {
    if (!env.REMOTE_AI_URL || !env.REMOTE_AI_MODEL) return { provider: null, mode: "rules", note: "No remote AI provider is configured." };
    const no = remoteAllowed();
    if (no) return { provider: null, mode: "rules", note: no };
    const cls = hostClass(env.REMOTE_AI_URL);
    if (cls === "public" && !/^https:/i.test(env.REMOTE_AI_URL)) return { provider: null, mode: "rules", note: "The remote AI URL must use https." };
    return { provider: { kind: "remote", dialect: "openai", url: env.REMOTE_AI_URL, model: env.REMOTE_AI_MODEL, key: env.REMOTE_AI_KEY || undefined }, mode: "remote" };
  }
  return { provider: null, mode: "rules", note: `Unknown AI_MODE “${env.AI_MODE}”.` };
}

/** Replaces personal data with numbered placeholders before text leaves the server, and puts it back in replies. */
export class Redactor {
  private map = new Map<string, string>();
  private byValue = new Map<string, string>();
  private count = { customer: 0, phone: 0, email: 0 };
  private names = new Set<string>();
  private nameRe: RegExp | null = null;
  constructor(names: string[] = []) { this.addNames(names); }
  private token(kind: "customer" | "phone" | "email", value: string) {
    const norm = value.toLowerCase().replace(/\s+/g, " ");
    const key = kind + ":" + norm;
    let t = this.byValue.get(key);
    if (!t) {
      t = `[${kind} ${++this.count[kind]}]`;
      this.byValue.set(key, t);
      this.map.set(t, kind === "customer" ? [...this.names].find((n) => n.toLowerCase().replace(/\s+/g, " ") === norm) ?? value : value);
    }
    return t;
  }
  addNames(names: string[]) {
    const before = this.names.size;
    for (const n of names) if (n.trim().length >= 3) this.names.add(n.trim());
    if (this.names.size === before) return;
    const alt = [...this.names].sort((a, b) => b.length - a.length).map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+")).join("|");
    this.nameRe = new RegExp(`(?<![\\p{L}\\p{N}])(?:${alt})(?![\\p{L}\\p{N}])`, "giu");
  }
  redact(text: string) {
    const out = text.replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, (m) => this.token("email", m)).replace(/(?<![\w])(?:\+?91[\s-]?)?[6-9]\d{4}[\s-]?\d{5}(?![\w])/g, (m) => this.token("phone", m));
    return this.nameRe ? out.replace(this.nameRe, (m) => this.token("customer", m)) : out;
  }
  restore(text: string) {
    return text.replace(/\[(customer|phone|email) \d+\]/g, (t) => this.map.get(t) ?? t);
  }
}

export type ChatMsg =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string; calls?: ToolCall[] }
  | { role: "tool"; content: string; callId: string; name: string };
export type ToolCall = { id: string; name: string; args: Record<string, unknown> };
export type ToolSpec = { name: string; description: string; params?: Record<string, unknown> };

const endpoint = (p: Provider) => p.dialect === "ollama" ? new URL("/api/chat", p.url).toString() : p.url.replace(/\/+$/, "").replace(/\/chat\/completions$/, "") + "/chat/completions";

function wire(p: Provider, m: ChatMsg) {
  if (m.role === "assistant") {
    const calls = m.calls?.length ? m.calls : undefined;
    return p.dialect === "ollama"
      ? { role: "assistant", content: m.content, ...(calls ? { tool_calls: calls.map((c) => ({ function: { name: c.name, arguments: c.args } })) } : {}) }
      : { role: "assistant", content: m.content || null, ...(calls ? { tool_calls: calls.map((c) => ({ id: c.id, type: "function", function: { name: c.name, arguments: JSON.stringify(c.args) } })) } : {}) };
  }
  if (m.role === "tool") return p.dialect === "ollama" ? { role: "tool", content: m.content, tool_name: m.name } : { role: "tool", tool_call_id: m.callId, content: m.content };
  return m;
}

const parseArgs = (a: unknown): Record<string, unknown> => {
  try { const v = typeof a === "string" ? JSON.parse(a || "{}") : a; return v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {}; } catch { return {}; }
};

/** One chat round with tool definitions. Throws on HTTP or network errors (including aborts). */
export async function chat(p: Provider, messages: ChatMsg[], tools: ToolSpec[], signal: AbortSignal): Promise<{ content: string; calls: ToolCall[] }> {
  const body = {
    model: p.model, stream: false, temperature: 0,
    ...(p.dialect === "ollama" ? { options: { temperature: 0 } } : {}),
    messages: messages.map((m) => wire(p, m)),
    tools: tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: { type: "object", properties: t.params ?? {} } } })),
  };
  const res = await fetch(endpoint(p), { method: "POST", signal, headers: { "content-type": "application/json", ...(p.key ? { authorization: `Bearer ${p.key}` } : {}) }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`Model server answered ${res.status}`);
  type Call = { id?: string; function?: { name?: string; arguments?: unknown } };
  const j = (await res.json()) as { message?: { content?: string; tool_calls?: Call[] }; choices?: { message?: { content?: string | null; tool_calls?: Call[] } }[] };
  const msg = p.dialect === "ollama" ? j.message : j.choices?.[0]?.message;
  const calls = (msg?.tool_calls ?? []).filter((c) => c.function?.name).map((c, i) => ({ id: c.id ?? `call_${i}`, name: c.function!.name!, args: parseArgs(c.function!.arguments) }));
  return { content: (msg?.content ?? "").trim(), calls };
}
