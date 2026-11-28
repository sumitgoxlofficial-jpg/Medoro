import "server-only";
import { generateVAPIDKeys, sendNotification } from "web-push";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { seal, unseal } from "@/server/vault";
import { log } from "@/server/log";

// Free browser push for Naina's calls, so a phone or laptop rings even when the HRMS isn't open. The browser's own push
// service (Google, Mozilla, Microsoft, Apple) delivers it at no cost. The server's key pair is made on first use and
// kept in HrSetting (the private key sealed with HOST_KEY); each employee's subscriptions are kept there too.

const VAPID = "aiHrVapid";
const subKey = (staffId: string) => `aiHrPush:${staffId}`;
/** Only real push services: the server posts to this address, so nothing else may be registered. */
const PUSH_HOSTS = /^(fcm\.googleapis\.com|android\.googleapis\.com|updates\.push\.services\.mozilla\.com|[a-z0-9-]+\.push\.services\.mozilla\.com|[a-z0-9-]+\.notify\.windows\.com|web\.push\.apple\.com|[a-z0-9-]+\.push\.apple\.com)$/i;

export const pushSubSchema = z.object({
  endpoint: z.string().max(1000).url().refine((u) => { try { const x = new URL(u); return x.protocol === "https:" && PUSH_HOSTS.test(x.hostname); } catch { return false; } }, "That isn't a browser push address."),
  keys: z.object({ p256dh: z.string().min(20).max(200), auth: z.string().min(8).max(100) }),
});
export type PushSub = z.infer<typeof pushSubSchema> & { at: string };

let keys: { publicKey: string; privateKey: string } | null = null;
async function vapid() {
  if (keys) return keys;
  const read = async () => (await db.hrSetting.findUnique({ where: { key: VAPID } }))?.value as { publicKey?: string; privateKey?: string } | undefined;
  let v = await read();
  if (!v?.publicKey || !v.privateKey) {
    const k = generateVAPIDKeys();
    try { await db.hrSetting.create({ data: { key: VAPID, value: { publicKey: k.publicKey, privateKey: Buffer.from(seal(k.privateKey)).toString("base64") } } }); }
    catch (e) { if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")) throw e; } // another server made it first
    v = await read();
  }
  keys = { publicKey: v!.publicKey!, privateKey: unseal(Buffer.from(v!.privateKey!, "base64")).toString("utf8") };
  return keys;
}
export async function pushPublicKey() { return (await vapid()).publicKey; }

async function subsOf(staffId: string): Promise<PushSub[]> {
  const v = (await db.hrSetting.findUnique({ where: { key: subKey(staffId) } }))?.value;
  return Array.isArray(v) ? (v as PushSub[]).filter((s) => pushSubSchema.safeParse(s).success) : [];
}
async function writeSubs(staffId: string, subs: PushSub[]) {
  await db.hrSetting.upsert({ where: { key: subKey(staffId) }, update: { value: subs }, create: { key: subKey(staffId), value: subs } });
}
/** Keeps a device's subscription (five devices at most per person; the newest win). */
export async function savePushSub(staffId: string, raw: unknown) {
  const s = pushSubSchema.parse(raw);
  const rest = (await subsOf(staffId)).filter((x) => x.endpoint !== s.endpoint);
  await writeSubs(staffId, [...rest, { endpoint: s.endpoint, keys: s.keys, at: new Date().toISOString() }].slice(-5));
}
export async function removePushSub(staffId: string, endpoint: string) {
  await writeSubs(staffId, (await subsOf(staffId)).filter((x) => x.endpoint !== endpoint));
}
export async function pushDevices(staffId: string) { return (await subsOf(staffId)).length; }

const subject = () => { const u = process.env.APP_URL?.trim(); return u && /^https:\/\//.test(u) ? u.replace(/\/$/, "") : "https://medoro.in"; };

/** Sends a notification to every device the person turned it on for. Gone subscriptions are removed. Returns how many got it. */
export async function pushTo(staffId: string, msg: { title: string; body: string; url: string; tag: string }): Promise<number> {
  const subs = await subsOf(staffId);
  if (!subs.length) return 0;
  const k = await vapid();
  const payload = JSON.stringify(msg);
  let ok = 0;
  const gone: string[] = [];
  await Promise.all(subs.map(async (s) => {
    try {
      await sendNotification({ endpoint: s.endpoint, keys: s.keys }, payload, { vapidDetails: { subject: subject(), publicKey: k.publicKey, privateKey: k.privateKey }, TTL: 900, urgency: "high", timeout: 8000 });
      ok++;
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) gone.push(s.endpoint);
      else log.warn("naina push failed", { status: code ?? null, err: e instanceof Error ? e.message : String(e) });
    }
  }));
  if (gone.length) await writeSubs(staffId, subs.filter((s) => !gone.includes(s.endpoint)));
  return ok;
}
