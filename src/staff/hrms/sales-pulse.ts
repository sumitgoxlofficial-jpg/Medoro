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

// ── Welcomes: when HR or the super admin adds someone to Sales (or introduces a new employee there), every bot welcomes
// them once, each at a different minute over roughly the next two hours (only between 10:00 and 18:30; later ones move
// to the next morning). The queue sits in HrSetting under `salesPulseWelcome:<staffId>`; the row stays once done, so the
// same person is never welcomed twice.
const W_EN: ((n: string) => string)[] = [
  (n) => `Welcome to the team, ${n}! 🎉`,
  (n) => `Hey ${n}, welcome aboard! Let's close some deals together 💪`,
  (n) => `Welcome ${n} 🙌 Ping me anytime for demo tips.`,
  (n) => `Big welcome to ${n}! The Medoro sales family just got stronger 🚀`,
  (n) => `Welcome ${n}! Your first sale is going to feel amazing 😄`,
  (n) => `Glad to have you, ${n}. All the best! 👏`,
  (n) => `Welcome ${n}! Pro tip: show them expiry alerts in the demo, works every time 😉`,
  (n) => `Hi ${n}, welcome! Looking forward to your first win 🎯`,
  (n) => `Warm welcome, ${n} 🌟`,
  (n) => `Welcome to Sales, ${n}! Let's smash the target this month 🔥`,
  (n) => `Welcome ${n}! Happy to help with your first few demo calls 📞`,
  (n) => `A very warm welcome to ${n} 🤝`,
  (n) => `Welcome onboard ${n}! Great things ahead 💯`,
  (n) => `Hello ${n}, welcome! You'll love this team 😊`,
  (n) => `Welcome ${n}! Can't wait to see your name in the wins here 🏆`,
  (n) => `Cheers to new beginnings, welcome ${n} 🥳`,
];
const W_HI: ((n: string) => string)[] = [
  (n) => `${n} जी, टीम में आपका स्वागत है 🙏`,
  (n) => `स्वागत है ${n}! मिलकर खूब सेल करेंगे 💪`,
  (n) => `${n}, Medoro सेल्स परिवार में आपका हार्दिक स्वागत है 🎉`,
  (n) => `वेलकम ${n}! पहली सेल के लिए ढेर सारी शुभकामनाएँ 🌟`,
  (n) => `${n} का स्वागत है, कोई भी मदद चाहिए तो बताइए 😊`,
  (n) => `नई शुरुआत की बधाई ${n}! स्वागत है 🥳`,
  (n) => `${n} जी, स्वागत है! डेमो कॉल में कोई दिक्कत हो तो पूछ लेना 📞`,
  (n) => `टीम में नया साथी, ${n}! हार्दिक स्वागत 🤝`,
  (n) => `स्वागत ${n}! इस महीने का टारगेट साथ में पूरा करेंगे 🎯`,
  (n) => `${n}, आपका स्वागत है। बहुत आगे जाओगे 👏`,
  (n) => `हार्दिक अभिनंदन ${n} 🌸`,
  (n) => `${n} जी, Sales टीम में स्वागत है, ऑल द बेस्ट 💯`,
  (n) => `स्वागत है ${n}! जल्दी ही यहाँ आपकी पहली सेल का मैसेज देखना है 🏆`,
  (n) => `${n}, आपका बहुत बहुत स्वागत है 🙌`,
  (n) => `वेलकम ${n} जी, टीम और मज़बूत हो गई 🚀`,
  (n) => `${n} का दिल से स्वागत 😊`,
];
const W_HG: ((n: string) => string)[] = [
  (n) => `Welcome ${n} bhai/behen, team me swagat hai 🙌`,
  (n) => `${n} ka swagat hai! Chalo milke sales todte hai 💪`,
  (n) => `Welcome ${n}! Koi bhi doubt ho toh seedha ping karna 😊`,
  (n) => `Arre welcome ${n} 🎉 pehli sale jaldi aayegi!`,
  (n) => `${n}, Medoro sales family me swagat hai 🚀`,
  (n) => `Welcome welcome ${n} 🥳 team aur strong ho gayi`,
  (n) => `${n} welcome! Demo me GST billing dikhana, client turant maan jaata hai 😉`,
  (n) => `Swagat hai ${n}, all the best 👏`,
  (n) => `${n} ko dil se welcome 🤝`,
  (n) => `Welcome ${n}! Is mahine target saath me cross karenge 🎯`,
  (n) => `Hello ${n}, welcome! Pehle demo ke liye best of luck 📞`,
  (n) => `${n} aa gaye team me, ab toh sales aur badhegi 🔥`,
  (n) => `Welcome ${n} ji 🙏 kuch bhi help chahiye toh batana`,
  (n) => `${n}, swagat hai! Jaldi yahan tumhari first win dekhni hai 🏆`,
  (n) => `Big welcome ${n} 🌟 maza aayega saath kaam karke`,
  (n) => `${n} welcome to Sales! Chalo shuru karte hai 💯`,
];
const W_POOL = W_EN.flatMap((e, i) => [e, W_HI[i], W_HG[i]]);
const WELCOME_PREFIX = "salesPulseWelcome:";
type Pending = { at: string; senderId: string; body: string };

/** Moves a time outside 10:00-18:30 India time into the next working window, keeping its offset so the spread survives. */
function inWindow(t: number, offsetMin: number): number {
  const day = istDay(new Date(t)), midnight = Date.parse(`${day}T00:00:00Z`) - IST, min = (t - midnight) / 60_000;
  if (min >= START && min <= END) return t;
  const base = min < START ? midnight : midnight + 86400_000;
  return base + (START + offsetMin) * 60_000;
}

/** Every bot's welcome for one person: different message each, at a different minute (about 2 to 140 minutes on). */
export function welcomePlan(staffId: string, name: string, from: Date): Pending[] {
  const r = rng(`medoro-sales-welcome:${staffId}`);
  const first = name.trim().split(/\s+/)[0] || name;
  const msgs = [...W_POOL];
  for (let i = msgs.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [msgs[i], msgs[j]] = [msgs[j], msgs[i]]; }
  const bots = [...PERSONAS];
  for (let i = bots.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [bots[i], bots[j]] = [bots[j], bots[i]]; }
  return bots.map((b, k) => {
    const offset = 2 + k * 3 + Math.floor(r() * 3); // one bot every ~3 minutes, never two in the same minute
    const at = inWindow(from.getTime() + offset * 60_000 + Math.floor(r() * 60) * 1000, offset);
    return { at: new Date(at).toISOString(), senderId: b.id, body: msgs[k](first) };
  });
}

/** Queues the bots' welcomes for these people, unless they were welcomed before. */
export async function scheduleWelcome(people: { id: string; name: string }[], now = new Date()) {
  for (const p of people) {
    if (isPulse(p.id)) continue;
    try { await db.hrSetting.create({ data: { key: WELCOME_PREFIX + p.id, value: { name: p.name, pending: welcomePlan(p.id, p.name, now) } } }); }
    catch { /* already welcomed (or queued) */ }
  }
}

const INTRO = /\b(new (employee|joinee|joiner|member|colleague|team ?mate|hire)|joined|joining|welcome|please welcome|swagat)\b|नया|नई|नए|स्वागत|जॉइन/i;
/**
 * HR or the super admin introducing someone in Sales ("Please welcome Rohan, our new employee"): the bots welcome the
 * member named in the message, or else the most recent member added in the last week who hasn't been welcomed yet.
 */
export async function welcomeFromIntro(me: { id: string; role: string }, chat: string, body: string) {
  if ((me.role !== "hr" && me.role !== "admin") || !INTRO.test(body)) return;
  const c = await db.hrChat.findUnique({ where: { id: chat }, select: { sysKey: true } });
  if (c?.sysKey !== PULSE_KEY) return;
  const mem = await db.hrChatMember.findMany({ where: { chatId: chat, staffId: { not: me.id } }, select: { staffId: true, joinedAt: true }, orderBy: { joinedAt: "desc" } });
  const ids = mem.map((m) => m.staffId).filter((id) => !isPulse(id));
  const users = await db.staffUser.findMany({ where: { id: { in: ids }, status: "active" }, select: { id: true, name: true } });
  const text = body.toLowerCase();
  const joined = new Map(mem.map((m) => [m.staffId, m.joinedAt.getTime()]));
  // A full name counts for anyone; a first name only for people added in the last 30 days (so an old Rohan isn't greeted).
  const named = users.filter((u) => {
    const parts = u.name.toLowerCase().split(/\s+/).filter((x) => x.length > 2);
    const fresh = Date.now() - (joined.get(u.id) ?? 0) < 30 * 86400_000;
    return text.includes(u.name.toLowerCase()) || (fresh && parts[0] && new RegExp(`(^|[^\\p{L}])${parts[0].replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^\\p{L}]|$)`, "u").test(text));
  });
  if (named.length) return scheduleWelcome(named);
  const done = new Set((await db.hrSetting.findMany({ where: { key: { in: ids.map((id) => WELCOME_PREFIX + id) } }, select: { key: true } })).map((r) => r.key.slice(WELCOME_PREFIX.length)));
  const recent = mem.find((m) => !isPulse(m.staffId) && !done.has(m.staffId) && Date.now() - m.joinedAt.getTime() < 7 * 86400_000);
  const u = recent && users.find((x) => x.id === recent.staffId);
  if (u) await scheduleWelcome([u]);
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

      // Welcomes that are due. Unlike the daily messages, a late welcome is still sent.
      const queued = await tx.hrSetting.findMany({ where: { key: { startsWith: WELCOME_PREFIX } } });
      for (const q of queued) {
        const v = q.value as { name?: string; pending?: Pending[] };
        const pending = v.pending ?? [];
        if (!pending.length) continue;
        const due = pending.filter((x) => new Date(x.at) <= now), rest = pending.filter((x) => new Date(x.at) > now);
        if (!due.length) continue;
        if (s.enabled) for (const x of due) { const at = new Date(x.at); await write(x.senderId, "pulse", x.body, now.getTime() - at.getTime() > CATCH_UP_MS ? now : at); }
        await tx.hrSetting.update({ where: { key: q.key }, data: { value: { name: v.name ?? "", pending: rest } } });
      }

      if (lastAt) await tx.hrChat.update({ where: { id: chat }, data: { lastAt } });
      await tx.hrSetting.upsert({ where: { key: STATE_KEY }, create: { key: STATE_KEY, value: s }, update: { value: s } });
    }, { timeout: 20_000 });
  } catch (e) {
    log.error("Sales Pulse tick failed.", { err: e });
  }
}
