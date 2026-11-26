import "server-only";
import { db } from "@/server/db";
import { seal } from "@/server/vault";
import { log } from "@/server/log";
import { PRODUCTS } from "../constants";

// Sales Pulse: the "Sales" company channel in Team Chat.
// 1. Real wins: when someone closes a sale (ConversionRecord) or books a demo (DemoBooking), a short announcement is posted
//    into the channel from that person's own account, as kind "win". The chat shows it with an "auto" tag so nobody thinks
//    they typed it.
// 2. Motivation bots: 45 named personas (20 women, 25 men) each post one sales message every day between 10:00 and
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
// 60 message styles, all about a sale closed, a demo booked or a demo done: 20 English, 20 Hindi, 20 Hinglish.
const s = (n: number) => (n === 1 ? "sale" : "sales");
const EN: ((f: Fill) => string)[] = [
  (f) => `${f.n} ${s(f.n)} closed today 🎉 Let's keep it going, team!`,
  (f) => `${f.d} demo calls booked for tomorrow ✅`,
  (f) => `Closed a Medoro ${f.plan} deal with a pharmacy in ${f.city} 💪`,
  (f) => `Another one! A chemist in ${f.city} just signed up for ${f.plan} 🚀`,
  (f) => `Done with ${f.d} demo calls this morning. ${cap(f.feat)} is a big hit with pharmacy owners.`,
  (f) => `Trial converted to paid today 🙌 ${f.plan} plan, ${f.city}.`,
  (f) => `${f.n} closed, ${f.d} demos done. Good day so far 🔥`,
  (f) => `Demo done with a 3-store owner in ${f.city}, they took Multi-branch on the call 🏬`,
  (f) => `Demo call went great, client in ${f.city} said yes on the call itself 😄`,
  (f) => `Closed a sale on the second follow-up call. ${f.plan} plan ✅`,
  (f) => `${f.d} demos lined up for the afternoon, ${f.n} already closed today 🤞`,
  (f) => `Sold the AI Pharmacy Manager add-on to an existing ${f.plan} client 🤖`,
  (f) => `A lead from ${f.city} that said "not now" last month just bought ${f.plan} 🙌`,
  (f) => `${f.n} ${s(f.n)} closed before lunch. Second half, let's go! ⚡`,
  (f) => `Booked ${f.d} demos from today's calls. ${cap(f.feat)} gets them every time.`,
  (f) => `Finished a video demo with a chemist in ${f.city}. Payment link sent, deal closed 💳`,
  (f) => `Sale closed! ${f.city} pharmacy moving from register billing to Medoro ${f.plan} 📒➡️💻`,
  (f) => `${f.d} demo calls done, ${f.n} converted on the spot 🎯`,
  (f) => `In-person demo done in ${f.city}. Owner signed up for ${f.plan} right there 🤝`,
  (f) => `Today: ${f.n} ${s(f.n)} closed + ${f.d} demos booked. Medoro is selling itself 🚀`,
];
const HI: ((f: Fill) => string)[] = [
  (f) => `आज ${f.n} सेल क्लोज़ हुई 🎉 चलो टीम, और आगे बढ़ते हैं!`,
  (f) => `${f.d} डेमो कॉल बुक हो गए ✅`,
  (f) => `${f.city} के एक मेडिकल स्टोर ने Medoro ${f.plan} ले लिया 💪`,
  (f) => `अभी अभी एक डील क्लोज़ की, कस्टमर को ${f.featHi} बहुत पसंद आया 🙌`,
  (f) => `ट्रायल वाला क्लाइंट आज ${f.plan} पर पेड हो गया 🎯`,
  (f) => `आज ${f.d} डेमो बुक किए, कल सबको Medoro दिखाऊँगा 🚀`,
  (f) => `फॉलो-अप का फल मीठा होता है, आज ${f.city} में एक और सेल पक्की 😊`,
  (f) => `${f.city} वाले क्लाइंट ने डेमो के बाद तुरंत हाँ बोल दिया 🎉`,
  (f) => `आज शाम तक ${f.d} और डेमो हैं, ${f.n} सेल हो चुकी 💪`,
  (f) => `पुराने लीड को फिर से कॉल किया और ${f.plan} की सेल हो गई ✅`,
  (f) => `${f.plan} प्लान की डील पक्की, ${f.city} का कस्टमर बहुत खुश है 😊`,
  (f) => `${f.d} डेमो कॉल पूरे हुए, ${f.n} ने तुरंत साइन अप किया 🔥`,
  (f) => `${f.city} में 3 स्टोर वाले मालिक ने Multi-branch लिया 🏬`,
  (f) => `डेमो में ${f.featHi} दिखाया और सेल हो गई 😄`,
  (f) => `आज का पहला डेमो ${f.city} में हुआ, क्लाइंट ने ${f.plan} लिया 🙏`,
  (f) => `लंच से पहले ${f.n} सेल क्लोज़, अब ${f.d} डेमो बाकी ⏰`,
  (f) => `वीडियो डेमो पूरा हुआ, पेमेंट लिंक भेज दिया, ${f.plan} पक्का 💳`,
  (f) => `${f.city} के केमिस्ट ने कहा अब रजिस्टर नहीं, सिर्फ Medoro ✅`,
  (f) => `आज ${f.n} सेल और ${f.d} डेमो, दिन शानदार रहा 🎉`,
  (f) => `AI Pharmacy Manager ऐड-ऑन बेचा, ${f.city} वाले क्लाइंट को 🤖`,
];
const HG: ((f: Fill) => string)[] = [
  (f) => `Aaj ${f.n} sale close ho gayi 🎉 chalo team, target pakka!`,
  (f) => `${f.d} demo call book kar liye 🔥 kal sabko Medoro dikhana hai`,
  (f) => `${f.city} wale chemist ne ${f.plan} plan le liya 💪`,
  (f) => `Trial wala client aaj ${f.plan} pe paid ho gaya 🙌`,
  (f) => `Bas abhi ek aur sale close ki, ${f.feat} dekh ke turant haan bol diya 😄`,
  (f) => `${f.n} closed + ${f.d} demo booked, aaj ka din mast hai 🚀`,
  (f) => `Follow-up karte raho guys, aaj ${f.city} ka purana lead convert hua ✅`,
  (f) => `${f.city} me 3 store wale owner ne Multi-branch liya 🏬 big one!`,
  (f) => `Lunch se pehle ${f.n} closing ho gayi, ab ${f.d} demo ka time ⏰`,
  (f) => `Client bola ${f.feat} toh kamaal hai, turant ${f.plan} sign up 😄`,
  (f) => `${f.d} demo done, ${f.n} ne on the spot payment kar diya 💳`,
  (f) => `${f.city} ka lead 2 hafte se pending tha, aaj convert ho gaya 🙌`,
  (f) => `Kal ke liye ${f.d} demo fix, sab owners interested lag rahe hai 🔥`,
  (f) => `Video demo khatam, ${f.city} wale bhaiya ne ${f.plan} le liya 🎯`,
  (f) => `Aaj ka pehla demo hi close ho gaya 😎 ${f.plan} plan`,
  (f) => `AI Pharmacy Manager add-on bhi bech diya ${f.city} me 🤖`,
  (f) => `Shop visit karke demo diya ${f.city} me, deal done 🤝`,
  (f) => `${f.n} sale aur ${f.d} demo, aaj Medoro full form me hai 🚀`,
  (f) => `${f.city} wale client ne bola register band, ab sirf Medoro ✅`,
  (f) => `Demo call pe hi ${f.plan} close, ${f.feat} ne kaam kar diya 💪`,
];
const cap = (x: string) => x.charAt(0).toUpperCase() + x.slice(1);
/** English, Hindi and Hinglish interleaved, so neighbouring bots (and each bot from one day to the next) switch language. */
const POOL = EN.flatMap((e, i) => [e, HI[i], HG[i]]);

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

/**
 * The day's bot messages: every one of the 45 bots posts once, at a random minute between 10:00 and 18:30 India time.
 * Templates rotate daily, so on a given day no two bots send the same message and no bot repeats yesterday's.
 */
export function daySchedule(day: string): Slot[] {
  const r = rng(`medoro-sales-pulse:${day}`);
  const midnight = Date.parse(`${day}T00:00:00Z`) - IST;
  const dayNo = Math.round(Date.parse(`${day}T00:00:00Z`) / 86400_000);
  const pool = POOL.length;
  return PERSONAS.map((p, i) => {
    const m = START + Math.floor(r() * (END - START + 1));
    const f: Fill = { n: 1 + Math.floor(r() * 3), d: 2 + Math.floor(r() * 5), city: pick(r, CITIES), plan: pick(r, PLANS), feat: pick(r, FEATURES), featHi: pick(r, FEATURES_HI) };
    const t = POOL[(((i + dayNo * 7) % pool) + pool) % pool];
    return { at: new Date(midnight + m * 60_000 + Math.floor(r() * 60) * 1000), senderId: p.id, body: t(f) };
  }).sort((a, b) => a.at.getTime() - b.at.getTime());
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

/** People always kept in the Sales channel: the super admin and HR. Everyone else is added (or removed) by them by hand. */
export async function pulseMemberIds(): Promise<string[]> {
  const staff = await db.staffUser.findMany({ where: { kind: "team", status: "active", OR: [{ role: "super_admin" }, { hr: { role: "hr" } }] }, select: { id: true } });
  return staff.map((s) => s.id);
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
