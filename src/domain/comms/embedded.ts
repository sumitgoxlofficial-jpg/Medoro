import "server-only";
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import QRCode from "qrcode";
import type { AuthenticationCreds, SignalDataSet, SignalDataTypeMap, WASocket } from "baileys";
import { log } from "@/server/log";

// WhatsApp through the pharmacy's own phone, run inside Medoro itself (no connector to install). Taken from FITRON for
// Windows (fitron-windows-app, src/lib/integrations/whatsapp/embedded.ts): the pharmacy links its phone once by scanning
// a QR code on the WhatsApp screen, and Medoro's server keeps that link while it runs, using Baileys (a WebSocket
// implementation of WhatsApp's multi-device protocol). It needs a server that keeps running: Medoro on the pharmacy's
// own computer or server (Docker, self-hosted). On Vercel the server stops between requests, so it is not offered there.
// Everything is kept on this server's disk, under WA_DATA_DIR (default STORAGE_DIR/whatsapp), per pharmacy:
//   session/       the link's keys, each file encrypted (AES-256-GCM, key derived from HOST_KEY)
//   outbox/        messages waiting to go out: sent at a gentle pace while Medoro runs, kept across restarts
//   results.json   what became of each message (sent, delivered, read, failed), by Medoro's own message key
//   stopped.json   numbers that replied STOP: not messaged again until they reply START

/** Seconds between two messages, and messages a day: a gentle pace, as a person sending them would. */
const PACE_MS = 2_500;
export const DAILY_CAP = 300;
const MAX_ATTEMPTS = 5;
const KEEP_RESULTS_MS = 30 * 86_400_000;

export type EmbeddedState = "ready" | "qr" | "starting" | "reconnecting" | "disconnected";
export type EmbeddedStatus = { state: EmbeddedState; number?: string; qr?: string; sentToday: number; cap: number; queued: number; error: string | null };
type Result = { status: "Sent" | "Delivered" | "Read" | "Failed"; error?: string; providerId?: string; at: string; sentAt?: string };
type OutboxItem = { localId: string; to: string; body: string; pdf?: { filename: string; base64: string }; at: string; attempts: number; lastError?: string };

type Session = {
  id: string;
  sock: WASocket | null;
  state: EmbeddedState;
  qr: string | null;
  phone: string | null;
  error: string | null;
  retries: number;
  sending: boolean;
  timer: NodeJS.Timeout | null;
  reconnect: NodeJS.Timeout | null;
  stopped: boolean;
};

const g = globalThis as unknown as { medoroWhatsApp?: Map<string, Session> };
const sessions = () => (g.medoroWhatsApp ??= new Map());

// ── Where things are, and the key ──

const safe = (s: string) => s.replace(/[^A-Za-z0-9_-]/g, "_");
export const dataRoot = () => path.resolve(process.env.WA_DATA_DIR || path.join(process.env.STORAGE_DIR ?? "./storage", "whatsapp"));
export const whatsappDir = (id: string, root = dataRoot()) => path.join(root, safe(id));
const dirs = (id: string) => {
  const base = whatsappDir(id);
  return { base, session: path.join(base, "session"), outbox: path.join(base, "outbox"), results: path.join(base, "results.json"), stopped: path.join(base, "stopped.json") };
};

/** The key the link's files are encrypted with: derived from this server's HOST_KEY, never stored. */
function sessionKey(): Buffer {
  const secret = process.env.HOST_KEY?.trim() || process.env.SESSION_SECRET?.trim() || "";
  if (!secret) throw new Error("This server has no HOST_KEY to protect the WhatsApp link with.");
  return Buffer.from(hkdfSync("sha256", secret, "medoro-whatsapp", "session-files", 32));
}

const MAGIC = Buffer.from("WAC1");
export function encrypt(plain: string, key: Buffer): Buffer {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return Buffer.concat([MAGIC, iv, c.getAuthTag(), data]);
}
export function decrypt(blob: Buffer, key: Buffer): string {
  if (blob.length < 32 || !blob.subarray(0, 4).equals(MAGIC)) throw new Error("Not an encrypted WhatsApp file");
  const d = createDecipheriv("aes-256-gcm", key, blob.subarray(4, 16));
  d.setAuthTag(blob.subarray(16, 32));
  return Buffer.concat([d.update(blob.subarray(32)), d.final()]).toString("utf8");
}

function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(readFileSync(file, "utf8")) as T;
  } catch {
    return fallback;
  }
}
function writeJson(file: string, value: unknown) {
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(value), { mode: 0o600 });
  renameSync(tmp, file);
}

// ── The link's keys, encrypted on disk ──

async function authState(folder: string, key: Buffer) {
  const { BufferJSON, initAuthCreds, proto } = await import("baileys");
  await mkdir(folder, { recursive: true, mode: 0o700 });
  const name = (f: string) => path.join(folder, f.replace(/\//g, "__").replace(/:/g, "-"));
  const locks = new Map<string, Promise<unknown>>();
  const serial = <T,>(f: string, fn: () => Promise<T>): Promise<T> => {
    const next = (locks.get(f) ?? Promise.resolve()).then(fn, fn);
    locks.set(f, next.catch(() => undefined));
    return next;
  };
  const write = (data: unknown, f: string) => serial(f, () => writeFile(name(f), encrypt(JSON.stringify(data, BufferJSON.replacer), key), { mode: 0o600 }));
  const read = <T,>(f: string) =>
    serial(f, async (): Promise<T | null> => {
      try {
        return JSON.parse(decrypt(await readFile(name(f)), key), BufferJSON.reviver) as T;
      } catch {
        return null;
      }
    });
  const remove = (f: string) => serial(f, () => unlink(name(f)).catch(() => undefined));
  const creds: AuthenticationCreds = (await read<AuthenticationCreds>("creds.json")) ?? initAuthCreds();
  return {
    creds,
    keys: {
      get: async <T extends keyof SignalDataTypeMap>(type: T, ids: string[]) => {
        const out: { [id: string]: SignalDataTypeMap[T] } = {};
        await Promise.all(
          ids.map(async (id) => {
            let v = await read<SignalDataTypeMap[T]>(`${type}-${id}.json`);
            if (type === "app-state-sync-key" && v) v = proto.Message.AppStateSyncKeyData.fromObject(v as object) as unknown as SignalDataTypeMap[T];
            if (v) out[id] = v;
          }),
        );
        return out;
      },
      set: async (data: SignalDataSet) => {
        const tasks: Promise<unknown>[] = [];
        for (const cat of Object.keys(data) as (keyof SignalDataSet)[]) for (const [id, v] of Object.entries(data[cat] ?? {})) tasks.push(v ? write(v, `${cat}-${id}.json`) : remove(`${cat}-${id}.json`));
        await Promise.all(tasks);
      },
    },
    save: () => write(creds, "creds.json"),
  };
}

/** Whether this pharmacy's phone is linked on this server: a saved login with the phone's account in it. */
export function hasLink(id: string): boolean {
  try {
    const creds = JSON.parse(decrypt(readFileSync(path.join(dirs(id).session, "creds.json")), sessionKey())) as Partial<AuthenticationCreds>;
    return !!creds.me?.id;
  } catch {
    return false;
  }
}

// Baileys wants a pino-like logger; its output can contain message text and keys, so nothing is written.
const silent = { level: "silent", child: () => silent, trace: () => {}, debug: () => {}, info: () => {}, warn: () => {}, error: () => {}, fatal: () => {} };

// ── Results, the outbox and STOP ──

const results = (id: string) => readJson<Record<string, Result>>(dirs(id).results, {});
function record(id: string, localId: string, r: Omit<Result, "at">) {
  const all = results(id);
  const now = Date.now();
  for (const [k, v] of Object.entries(all)) if (now - Date.parse(v.at) > KEEP_RESULTS_MS) delete all[k];
  all[localId] = { ...all[localId], ...r, at: new Date().toISOString() };
  writeJson(dirs(id).results, all);
}
/** The day in India (YYYY-MM-DD). */
const istDay = (d: Date) => new Date(d.getTime() + 330 * 60_000).toISOString().slice(0, 10);
const sentToday = (id: string) => {
  const day = istDay(new Date());
  return Object.values(results(id)).filter((r) => r.sentAt && istDay(new Date(r.sentAt)) === day).length;
};
const outboxFiles = (id: string) => {
  const d = dirs(id).outbox;
  return existsSync(d) ? readdirSync(d).filter((f) => f.endsWith(".json")).sort() : [];
};
const stoppedNumbers = (id: string) => new Set(readJson<string[]>(dirs(id).stopped, []));

/** A customer replied STOP (or START) on WhatsApp: they are not messaged again until they reply START. */
export function noteReply(id: string, from: string, text: string) {
  const word = text.trim().toUpperCase();
  const set = stoppedNumbers(id);
  if (/^(STOP|STOPALL|STOP ALL|UNSUBSCRIBE)$/.test(word)) set.add(from);
  else if (/^(START|SUBSCRIBE)$/.test(word)) set.delete(from);
  else return;
  writeJson(dirs(id).stopped, [...set]);
}

// ── The link ──

function session(id: string): Session {
  let s = sessions().get(id);
  if (!s) {
    s = { id, sock: null, state: "disconnected", qr: null, phone: null, error: null, retries: 0, sending: false, timer: null, reconnect: null, stopped: false };
    sessions().set(id, s);
  }
  return s;
}

const digitsOf = (jid: string | null | undefined) => (jid ? jid.split("@")[0]!.split(":")[0]!.replace(/\D/g, "") : "");

async function connect(s: Session) {
  if (s.sock || s.stopped) return;
  s.state = s.retries ? "reconnecting" : "starting";
  const b = await import("baileys");
  const auth = await authState(dirs(s.id).session, sessionKey());
  const sock = b.makeWASocket({
    auth: { creds: auth.creds, keys: b.makeCacheableSignalKeyStore(auth.keys, silent as never) },
    logger: silent as never,
    browser: b.Browsers.windows("Medoro"),
    markOnlineOnConnect: false,
    syncFullHistory: false,
    shouldSyncHistoryMessage: () => false,
    generateHighQualityLinkPreview: false,
    connectTimeoutMs: 30_000,
    defaultQueryTimeoutMs: 60_000,
    keepAliveIntervalMs: 25_000,
    qrTimeout: 60_000,
  });
  s.sock = sock;
  sock.ev.on("creds.update", () => void auth.save().catch((e) => log.error("whatsapp.embedded.save_failed", { error: String(e) })));
  sock.ev.on("connection.update", (u) => {
    if (u.qr) {
      s.state = "qr";
      void QRCode.toDataURL(u.qr, { margin: 1, width: 264 }).then((d) => (s.qr = d));
    }
    if (u.connection === "open") {
      s.state = "ready";
      s.qr = null;
      s.error = null;
      s.retries = 0;
      s.phone = digitsOf(b.jidNormalizedUser(sock.user?.id)) || null;
      log.info("whatsapp.embedded.open", { tenant: s.id });
      void pump(s);
    }
    if (u.connection === "close") {
      s.sock = null;
      s.qr = null;
      const code = (u.lastDisconnect?.error as { output?: { statusCode?: number } } | undefined)?.output?.statusCode;
      if (s.stopped) return;
      if (code === b.DisconnectReason.loggedOut || code === b.DisconnectReason.forbidden) {
        rmSync(dirs(s.id).session, { recursive: true, force: true });
        s.state = "disconnected";
        s.phone = null;
        s.error = "WhatsApp was unlinked on the phone. Link it again on the WhatsApp screen.";
        return;
      }
      if (!auth.creds.me?.id && code !== b.DisconnectReason.restartRequired) {
        // The QR code was not scanned in time: wait for Link WhatsApp to be pressed again.
        s.state = "disconnected";
        return;
      }
      s.retries++;
      s.state = "reconnecting";
      const wait = code === b.DisconnectReason.restartRequired ? 500 : Math.min(60_000, 2_000 * 2 ** Math.min(s.retries, 5));
      s.reconnect = setTimeout(() => void connect(s).catch((e) => fail(s, e)), wait);
      s.reconnect.unref?.();
    }
  });
  sock.ev.on("messages.update", (updates) => {
    const ids = idsBySent(s.id);
    for (const { key: k, update } of updates) {
      const localId = k.fromMe && k.id ? ids.get(k.id) : undefined;
      if (!localId) continue;
      const st = update.status;
      if (st === 3) record(s.id, localId, { status: "Delivered" });
      if (st === 4 || st === 5) record(s.id, localId, { status: "Read" });
    }
  });
  sock.ev.on("messages.upsert", ({ messages, type }) => {
    if (type !== "notify") return;
    for (const m of messages) {
      if (m.key.fromMe) continue;
      const from = digitsOf(m.key.remoteJidAlt ?? m.key.remoteJid);
      const text = m.message?.conversation ?? m.message?.extendedTextMessage?.text ?? "";
      if (from && text) noteReply(s.id, from, text);
    }
  });
  if (!s.timer) {
    s.timer = setInterval(() => void pump(s), 60_000);
    s.timer.unref?.();
  }
}

function fail(s: Session, e: unknown) {
  s.sock = null;
  s.state = "disconnected";
  s.error = e instanceof Error ? e.message : String(e);
  log.error("whatsapp.embedded.failed", { error: s.error });
}

function idsBySent(id: string) {
  const m = new Map<string, string>();
  for (const [localId, r] of Object.entries(results(id))) if (r.providerId) m.set(r.providerId, localId);
  return m;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Sends what is waiting, one at a time, while the phone is linked and the day's allowance lasts. */
async function pump(s: Session) {
  if (s.sending || s.state !== "ready" || !s.sock) return;
  s.sending = true;
  try {
    // The outbox is read again for each message, so one kept while another was going out is sent in the same round.
    for (let f = outboxFiles(s.id)[0]; f; f = outboxFiles(s.id)[0]) {
      if (s.stopped || s.state !== "ready" || !s.sock) break;
      if (sentToday(s.id) >= DAILY_CAP) break;
      const file = path.join(dirs(s.id).outbox, f);
      const item = readJson<OutboxItem | null>(file, null);
      if (!item) {
        rmSync(file, { force: true });
        continue;
      }
      if (stoppedNumbers(s.id).has(item.to)) {
        record(s.id, item.localId, { status: "Failed", error: "This customer replied STOP on WhatsApp, so Medoro does not message them until they reply START." });
        rmSync(file, { force: true });
        continue;
      }
      try {
        const found = (await s.sock.onWhatsApp(item.to))?.find((r) => r.exists);
        if (!found) {
          record(s.id, item.localId, { status: "Failed", error: "This number is not on WhatsApp." });
          rmSync(file, { force: true });
          continue;
        }
        const jid = found.jid || `${item.to}@s.whatsapp.net`;
        const sent = item.pdf
          ? await s.sock.sendMessage(jid, { document: Buffer.from(item.pdf.base64, "base64"), mimetype: "application/pdf", fileName: item.pdf.filename, caption: item.body })
          : await s.sock.sendMessage(jid, { text: item.body });
        record(s.id, item.localId, { status: "Sent", providerId: sent?.key?.id ?? undefined, sentAt: new Date().toISOString() });
        rmSync(file, { force: true });
      } catch (e) {
        const attempts = item.attempts + 1;
        const why = e instanceof Error ? e.message : String(e);
        if (attempts >= MAX_ATTEMPTS) {
          record(s.id, item.localId, { status: "Failed", error: `WhatsApp did not take the message after ${attempts} tries (${why}).` });
          rmSync(file, { force: true });
        } else writeJson(file, { ...item, attempts, lastError: why });
        // Try again on the next round, not straight away.
        break;
      }
      await sleep(PACE_MS);
    }
  } finally {
    s.sending = false;
  }
}

// ── What Medoro's delivery calls (connector.ts) ──

export const NOT_LINKED_HERE = "WhatsApp is not linked on this server. Press Link WhatsApp on the WhatsApp screen and scan the QR code with the pharmacy phone.";

/**
 * Keeps a message to send through the linked phone; it goes out in turn. Medoro's own key is the message's id. With no
 * phone linked here nothing is kept (it would wait for ever): null, and the caller says what to do.
 */
export function embeddedSend(id: string, m: { localId: string; to: string; body: string; pdf?: { bytes: Uint8Array; filename: string } }): string | null {
  if (!hasLink(id)) return null;
  const item: OutboxItem = { localId: m.localId, to: m.to, body: m.body, at: new Date().toISOString(), attempts: 0, ...(m.pdf ? { pdf: { filename: m.pdf.filename, base64: Buffer.from(m.pdf.bytes).toString("base64") } } : {}) };
  writeJson(path.join(dirs(id).outbox, `${Date.now().toString(36).padStart(10, "0")}-${safe(m.localId)}.json`), item);
  const s = session(id);
  if (s.state === "ready") void pump(s);
  else if (!s.sock) void connect(s).catch((e) => fail(s, e));
  return m.localId;
}

/**
 * What became of messages, by Medoro's keys: { key: { status, error } }. A message still waiting in the outbox is
 * Queued (so it is not given up on while the server was down); one this server never had is not listed.
 */
export function embeddedResults(id: string, keys: string[]): Record<string, { status: string; error?: string }> {
  const all = results(id);
  const want = new Set(keys);
  const out: Record<string, { status: string; error?: string }> = {};
  for (const f of outboxFiles(id)) {
    const item = readJson<OutboxItem | null>(path.join(dirs(id).outbox, f), null);
    if (item && want.has(item.localId)) out[item.localId] = { status: "Queued" };
  }
  for (const k of keys) if (all[k]) out[k] = { status: all[k].status, ...(all[k].error ? { error: all[k].error } : {}) };
  return out;
}

/** The link's state and, while it waits for a scan, the QR code. With `start`, linking starts (Link WhatsApp). */
export async function embeddedStatus(id: string, opts: { start?: boolean } = {}): Promise<EmbeddedStatus> {
  const s = session(id);
  if (!s.sock && s.state !== "reconnecting" && (opts.start || hasLink(id))) {
    s.stopped = false;
    s.error = null;
    await connect(s).catch((e) => fail(s, e));
  }
  return { state: s.state, ...(s.phone ? { number: s.phone } : {}), ...(s.state === "qr" && s.qr ? { qr: s.qr } : {}), sentToday: sentToday(id), cap: DAILY_CAP, queued: outboxFiles(id).length, error: s.error };
}

/** Unlink: the phone is logged out and the link's keys are deleted. Messages still waiting stay, unsent. */
export async function embeddedLogout(id: string) {
  const s = session(id);
  s.stopped = true;
  if (s.reconnect) clearTimeout(s.reconnect);
  try {
    await s.sock?.logout();
  } catch {
    // Already closed.
  }
  s.sock = null;
  s.state = "disconnected";
  s.phone = null;
  s.qr = null;
  rmSync(dirs(id).session, { recursive: true, force: true });
}

/** From the scheduler: every pharmacy whose phone is linked here reconnects (after a restart), so what is waiting goes out. */
export function resumeEmbeddedWhatsApp(root = dataRoot()) {
  if (!existsSync(root)) return;
  for (const id of readdirSync(root)) {
    const s = session(id);
    if (s.sock || s.stopped || s.state === "reconnecting" || !hasLink(id)) continue;
    void connect(s).catch((e) => fail(s, e));
  }
}
