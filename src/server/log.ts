// Structured JSON-lines logger: redacts sensitive keys, and scrubs credentials and contact details out of string values. Level from LOG_LEVEL (debug|info|warn|error, default info).
export type Level = "debug" | "info" | "warn" | "error";
const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const SENSITIVE = /pass(word|wd|phrase)?|token|secret|otp|authori[sz]ation|cookie|phone|mobile|e-?mail|api[-_]?key|private[-_]?key|^code$|^key$|signature|^sig$|authkey|^sek$|credential|dsn|database_?url/i;
const MAX_DEPTH = 6;

/** Error text and harmless-looking keys can still carry secrets (a Prisma error echoes its arguments). */
export function scrub(s: string): string {
  return s
    .replace(/Bearer\s+[\w.~+/=-]+/gi, "Bearer [redacted]")
    .replace(/:\/\/[^\s/@'"]+@/g, "://[redacted]@")
    .replace(/\$argon2\w*\$[^\s'"]+/g, "[hash]")
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, "[email]")
    .replace(/(?<![\w])(\+?91[\s-]?)?[6-9]\d{9}(?!\d)/g, "[phone]");
}

function threshold(): number {
  const l = (process.env.LOG_LEVEL ?? "").toLowerCase() as Level;
  return ORDER[l] ?? ORDER.info;
}

export function redact(value: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
  if (typeof value === "string") return scrub(value);
  if (value === null || typeof value !== "object") return typeof value === "bigint" ? value.toString() : value;
  if (depth >= MAX_DEPTH) return "[depth]";
  if (seen.has(value)) return "[circular]";
  seen.add(value);
  if (value instanceof Error) {
    const out: Record<string, unknown> = { name: value.name, message: scrub(value.message) };
    if (value.stack) out.stack = scrub(value.stack);
    if ("code" in value && typeof value.code === "string") out.errorCode = value.code;
    if (value.cause !== undefined) out.cause = redact(value.cause, depth + 1, seen);
    return out;
  }
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1, seen));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) out[k] = SENSITIVE.test(k) ? "[redacted]" : redact(v, depth + 1, seen);
  return out;
}

export function format(level: Level, msg: string, fields?: Record<string, unknown>): string {
  const base: Record<string, unknown> = { time: new Date().toISOString(), level, msg: scrub(msg) };
  if (fields) Object.assign(base, redact(fields) as Record<string, unknown>);
  return JSON.stringify(base);
}

function emit(level: Level, msg: string, fields?: Record<string, unknown>) {
  if (ORDER[level] < threshold()) return;
  const line = format(level, msg, fields);
  if (level === "error" || level === "warn") console.error(line);
  else console.log(line);
}

export const log = {
  debug: (msg: string, fields?: Record<string, unknown>) => emit("debug", msg, fields),
  info: (msg: string, fields?: Record<string, unknown>) => emit("info", msg, fields),
  warn: (msg: string, fields?: Record<string, unknown>) => emit("warn", msg, fields),
  error: (msg: string, fields?: Record<string, unknown>) => emit("error", msg, fields),
};
