import "server-only";
import { db } from "@/server/db";
import { seal } from "@/server/vault";
import { log } from "@/server/log";
import { PRODUCTS } from "../constants";

// Sales Pulse: the "Sales" company channel in Team Chat.
// 1. Real wins: when someone closes a sale (ConversionRecord) or books a demo (DemoBooking), a short announcement is posted
//    into the channel from that person's own account, as kind "win". The chat shows it with an "auto" tag so nobody thinks
//    they typed it.
// 2. Motivation bots: 45 named personas (20 women, 25 men) post a few upbeat sales messages every day between 10:00 and
//    18:30 India time, in English, Hindi and Hinglish, as kind "pulse". They are not staff accounts: they have no login and
//    no HR profile, so they never appear in staff lists, attendance, payroll or the org chart, and every message and
//    profile is badged "Sales Pulse · auto" in the chat.

export const PULSE_KEY = "sales-pulse";
export const PULSE_PREFIX = "pulse:";
export const PULSE_LABEL = "Sales Pulse · auto";
export const PULSE_ABOUT = "Wins and demo bookings. Messages tagged ⚡ auto are posted automatically: real wins from the CRM, and motivation from the Sales Pulse bots (not real employees).";

const WOMEN = [
  "Priyanka Sharma", "Neha Verma", "Ananya Iyer", "Pooja Patel", "Kavya Reddy", "Sneha Kulkarni", "Riya Banerjee", "Aishwarya Nair", "Divya Joshi", "Shruti Mishra",
  "Megha Agarwal", "Tanvi Deshmukh", "Ishita Malhotra", "Nikita Chauhan", "Swati Pandey", "Pallavi Menon", "Simran Kaur", "Anjali Yadav", "Ritika Saxena", "Harini Subramanian",
] as const;
const MEN = [
  "Rahul Gupta", "Amit Singh", "Vikram Rathore", "Arjun Mehta", "Rohit Tiwari", "Karan Kapoor", "Sandeep Kumar", "Aditya Rao", "Manish Dubey", "Siddharth Jain",
  "Abhishek Srivastava", "Nikhil Bhatt", "Varun Choudhary", "Saurabh Pathak", "Pranav Joshi", "Deepak Nair", "Gaurav Sethi", "Harsh Patil", "Mohit Bansal", "Ankit Shukla",
  "Rajesh Pillai", "Suresh Gowda", "Kunal Sinha", "Yash Thakur", "Imran Qureshi",
] as const;

export type Persona = { id: string; name: string; gender: "f" | "m" };
export const PERSONAS: Persona[] = [
  ...WOMEN.map((name, i) => ({ id: `${PULSE_PREFIX}${String(i + 1).padStart(2, "0")}`, name, gender: "f" as const })),
  ...MEN.map((name, i) => ({ id: `${PULSE_PREFIX}${String(i + 21).padStart(2, "0")}`, name, gender: "m" as const })),
];
const byId = new Map(PERSONAS.map((p) => [p.id, p]));
export const isPulse = (id: string) => id.startsWith(PULSE_PREFIX);
export const pulseName = (id: string) => byId.get(id)?.name ?? "";

// ── Messages
const CITIES = ["Pune", "Jaipur", "Lucknow", "Indore", "Patna", "Nagpur", "Surat", "Kochi", "Bhopal", "Coimbatore", "Ludhiana", "Ranchi", "Vadodara", "Nashik", "Guwahati", "Kanpur", "Mysuru", "Agra"];
const PLANS = ["Starter", "Professional", "Multi-branch", "Professional", "Starter"];
const FEATURES = ["GST billing", "expiry alerts", "stock tracking", "WhatsApp reminders", "barcode billing", "the AI Pharmacy Manager"];
const FEATURES_HI = ["GST बिलिंग", "एक्सपायरी अलर्ट", "स्टॉक ट्रैकिंग", "WhatsApp रिमाइंडर", "बारकोड बिलिंग"];

type Fill = { n: number; d: number; city: string; plan: string; feat: string; featHi: string };
const EN: ((f: Fill) => string)[] = [
  (f) => `${f.n} ${f.n === 1 ? "sale" : "sales"} closed today 🎉 Let's keep it going, team!`,
  (f) => `${f.d} demo calls booked for tomorrow ✅`,
  (f) => `Closed a Medoro ${f.plan} deal with a pharmacy in ${f.city} 💪`,
  (f) => `Another one! A chemist in ${f.city} just signed up for ${f.plan} 🚀`,
  (f) => `Booked ${f.d} demos this morning. ${cap(f.feat)} is a big hit with pharmacy owners.`,
  () => `Trial converted to paid today 🙌 Follow-ups really work!`,
  (f) => `${f.n} closed, ${f.d} demos booked. Good day so far 🔥`,
  () => `Renewal done for a 3-store client, they upgraded to Multi-branch 🏬`,
  (f) => `Demo went great, client in ${f.city} said yes on the call itself 😄`,
  () => `Who's hitting target this week? I'm 2 away 💯`,
];
const HI: ((f: Fill) => string)[] = [
  (f) => `आज ${f.n} सेल क्लोज़ हुई 🎉 चलो टीम, और आगे बढ़ते हैं!`,
  (f) => `${f.d} डेमो कॉल बुक हो गए ✅`,
  (f) => `${f.city} के एक मेडिकल स्टोर ने Medoro ${f.plan} ले लिया 💪`,
  (f) => `अभी अभी एक डील क्लोज़ की, कस्टमर को ${f.featHi} बहुत पसंद आया 🙌`,
  () => `ट्रायल वाला क्लाइंट आज पेड हो गया 🎯`,
  (f) => `आज ${f.d} डेमो बुक किए, कल सबको Medoro दिखाऊँगा 🚀`,
  () => `फॉलो-अप का फल मीठा होता है, आज एक और सेल पक्की 😊`,
];
const HG: ((f: Fill) => string)[] = [
  (f) => `Aaj ${f.n} sale close ho gayi 🎉 chalo team, target pakka!`,
  (f) => `${f.d} demo call book kar liye 🔥 kal sabko Medoro dikhana hai`,
  (f) => `${f.city} wale chemist ne ${f.plan} plan le liya 💪`,
  () => `Trial wala client aaj paid ho gaya 🙌`,
  (f) => `Bas abhi ek aur sale close ki, ${f.feat} dekh ke turant haan bol diya 😄`,
  (f) => `${f.n} closed + ${f.d} demo booked, aaj ka din mast hai 🚀`,
  () => `Follow-up karte raho guys, aaj 2 purane leads convert hue ✅`,
  (f) => `${f.city} me 3 store wale owner ne Multi-branch liya 🏬 big one!`,
];
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Small seeded random generator, so a day's schedule is the same on every server and every call. */
function rng(seed: string) {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) { h = Math.imul(h ^ seed.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
  let a = h >>> 0;
  return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const pick = <T,>(r: () => number, xs: readonly T[]) => xs[Math.floor(r() * xs.length)];

const IST = 330 * 60_000;
const START = 10 * 60, END = 18 * 60 + 30; // minutes after midnight, India time
export type Slot = { at: Date; senderId: string; body: string };

/** The day's bot messages (10 to 16 of them), at random minutes between 10:00 and 18:30 India time. */
export function daySchedule(day: string): Slot[] {
  const r = rng(`medoro-sales-pulse:${day}`);
  const midnight = Date.parse(`${day}T00:00:00Z`) - IST;
  const n = 10 + Math.floor(r() * 7);
  const minutes = Array.from({ length: n }, () => START + Math.floor(r() * (END - START + 1))).sort((a, b) => a - b);
  let last = "";
  return minutes.map((m) => {
    let p = pick(r, PERSONAS);
    while (p.id === last) p = pick(r, PERSONAS);
    last = p.id;
    const f: Fill = { n: 1 + Math.floor(r() * 3), d: 2 + Math.floor(r() * 5), city: pick(r, CITIES), plan: pick(r, PLANS), feat: pick(r, FEATURES), featHi: pick(r, FEATURES_HI) };
    const lang = r(), set = lang < 0.4 ? EN : lang < 0.65 ? HI : HG;
    return { at: new Date(midnight + m * 60_000 + Math.floor(r() * 60) * 1000), senderId: p.id, body: pick(r, set)(f) };
  });
}
export const istDay = (d: Date) => new Date(d.getTime() + IST).toISOString().slice(0, 10);

// ── State: kept in HrSetting under one key. `enabled: false` there switches the bots off (real wins still post).
type State = { enabled: boolean; day: string; posted: number; winsAt: string };
const STATE_KEY = "salesPulse";
const CATCH_UP_MS = 30 * 60_000; // a slot missed by more than this (server asleep) is skipped, not posted late in a burst

async function chatId() {
  return (await db.hrChat.findUnique({ where: { sysKey: PULSE_KEY }, select: { id: true } }))?.id ?? null;
}

const planName = (id: string) => PRODUCTS.find((p) => p.id === id)?.name ?? "";
const MODES: Record<string, string> = { phone: "a phone demo", video: "a video demo", visit: "an in-person demo" };

/** Real people who should be in the Sales channel: the sales department, the super admin, and anyone with a recent win. */
export async function pulseMemberIds(): Promise<string[]> {
  const since = new Date(Date.now() - 60 * 86400_000);
  const [staff, conv, demos] = await Promise.all([
    db.staffUser.findMany({ where: { kind: "team", status: "active", role: { not: "partner" }, hr: { isNot: null } }, select: { id: true, role: true, hr: { select: { dept: true } } } }),
    db.conversionRecord.findMany({ where: { at: { gt: since } }, select: { staffId: true }, distinct: ["staffId"] }),
    db.demoBooking.findMany({ where: { createdAt: { gt: since } }, select: { staffId: true }, distinct: ["staffId"] }),
  ]);
  const sellers = new Set([...conv, ...demos].map((x) => x.staffId));
  return staff.filter((s) => s.role === "super_admin" || /sales|business dev/i.test(s.hr?.dept ?? "") || sellers.has(s.id)).map((s) => s.id);
}

let lastRun = 0;
/** Posts what is due: new real wins, and the bot messages whose time has come. Safe to call often and from many servers. */
export async function salesPulseTick(now = new Date(), force = false) {
  if (!force && Date.now() - lastRun < 30_000) return;
  lastRun = Date.now();
  const chat = await chatId();
  if (!chat) return; // syncChannels makes the channel
  try {
    await db.$transaction(async (tx) => {
      const [lock] = await tx.$queryRaw<{ ok: boolean }[]>`SELECT pg_try_advisory_xact_lock(472911) AS ok`;
      if (!lock?.ok) return; // another server is doing it right now
      const row = await tx.hrSetting.findUnique({ where: { key: STATE_KEY } });
      const saved = (row?.value ?? {}) as Partial<State>;
      const today = istDay(now);
      const s: State = { enabled: saved.enabled !== false, day: saved.day ?? today, posted: saved.posted ?? 0, winsAt: saved.winsAt ?? now.toISOString() };
      if (s.day !== today) { s.day = today; s.posted = 0; }
      let lastAt: Date | null = null;
      const write = async (senderId: string, kind: "win" | "pulse", body: string, at: Date) => {
        await tx.hrChatMessage.create({ data: { chatId: chat, senderId, kind, body: new Uint8Array(seal(body)), createdAt: at } });
        lastAt = at;
      };

      // Real wins since the last look (the first run starts from now: nothing old is announced).
      const since = new Date(s.winsAt);
      const [conv, demos] = await Promise.all([
        tx.conversionRecord.findMany({ where: { at: { gt: since, lte: now } }, orderBy: { at: "asc" }, take: 50, select: { staffId: true, product: true, at: true } }),
        tx.demoBooking.findMany({ where: { createdAt: { gt: since, lte: now } }, orderBy: { createdAt: "asc" }, take: 50, select: { staffId: true, mode: true, createdAt: true } }),
      ]);
      const wins = [
        ...conv.map((c) => ({ staffId: c.staffId, at: c.at, body: `Just closed a sale 🎉${planName(c.product) ? ` Medoro ${planName(c.product)}` : ""}` })),
        ...demos.map((d) => ({ staffId: d.staffId, at: d.createdAt, body: `Just booked ${MODES[d.mode] ?? "a demo"} call 📅` })),
      ].sort((a, b) => a.at.getTime() - b.at.getTime());
      for (const w of wins) await write(w.staffId, "win", w.body, w.at);
      if (wins.length) s.winsAt = wins[wins.length - 1].at.toISOString();

      // Bot messages that are due.
      const plan = daySchedule(today);
      while (s.posted < plan.length && plan[s.posted].at <= now) {
        const slot = plan[s.posted++];
        if (s.enabled && now.getTime() - slot.at.getTime() <= CATCH_UP_MS) await write(slot.senderId, "pulse", slot.body, slot.at);
      }

      if (lastAt) await tx.hrChat.update({ where: { id: chat }, data: { lastAt } });
      await tx.hrSetting.upsert({ where: { key: STATE_KEY }, create: { key: STATE_KEY, value: s }, update: { value: s } });
    }, { timeout: 20_000 });
  } catch (e) {
    log.error("Sales Pulse tick failed.", { err: e });
  }
}
