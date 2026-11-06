import "server-only";
import { z } from "zod";
import { db } from "@/server/db";
import { hit } from "@/server/ratelimit";
import { chat, resolveProvider } from "@/domain/ai/llm";
import { findLead, need, type Actor } from "./access";
import { categoryLabel, outcomeLabel, type Outcome } from "./constants";
import { computeScore } from "./score";
import { scoreFacts } from "./leads";

/**
 * Lead intelligence. Everything shown is labelled: verified (with evidence), user-provided (told to an employee), source
 * (as listed by the data source), AI-inferred (a rule's guess, never used for the score) or unknown. Nothing is invented:
 * owner details, revenue, current software and buying intent are unknown until someone records them.
 */
export type Label = "verified" | "user_provided" | "source" | "inferred" | "unknown";
export type Fact = { label: string; value: string; provenance: Label; evidence?: string };

const SW: Record<string, string> = { none: "No billing software", paper: "Paper / manual billing", other_unhappy: "Uses other software; unhappy with it", other_happy: "Uses other software; satisfied" };

export async function research(a: Actor, leadId: string) {
  need(a, "ai.use");
  const l = await findLead(a, leadId);
  const [src, calls, consents, demos] = await Promise.all([
    l.sourceId ? db.leadSource.findUnique({ where: { id: l.sourceId } }) : null,
    db.callSession.findMany({ where: { leadId, status: "reported" }, orderBy: { reportedAt: "desc" }, take: 10 }),
    db.contactConsent.findMany({ where: { leadId, revokedAt: null } }),
    db.demoBooking.findMany({ where: { leadId } }),
  ]);
  const facts: Fact[] = [
    { label: "Pharmacy name", value: l.name, provenance: l.businessVerifiedAt ? "verified" : "source", evidence: src ? `Listed by ${src.name}` : undefined },
    { label: "Category", value: categoryLabel(l.category), provenance: "source" },
    { label: "Owner / contact", value: l.ownerName || "Not known", provenance: l.ownerName ? (l.ownerVerified ? "verified" : "source") : "unknown" },
    { label: "Phone", value: l.phone ?? (l.phoneRaw || "Not known"), provenance: l.phoneVerifiedAt ? "verified" : l.phone ? "source" : "unknown", evidence: l.phoneVerifiedAt ? "Confirmed on a call" : undefined },
    { label: "Email", value: l.email || "Not known", provenance: l.emailVerifiedAt ? "verified" : l.email ? "source" : "unknown" },
    { label: "Website", value: l.website || "None listed", provenance: l.websiteVerifiedAt ? "verified" : l.website ? "source" : "unknown" },
    { label: "Location", value: [l.address, l.city, l.district, l.state, l.pin].filter(Boolean).join(", ") || "Not known", provenance: l.locationVerifiedAt ? "verified" : l.address || l.pin ? "source" : "unknown" },
    { label: "Current billing software", value: SW[l.softwareStatus] ?? "Not asked yet", provenance: l.softwareStatus ? "user_provided" : "unknown" },
    { label: "Turnover / revenue", value: "Not known", provenance: "unknown" },
    { label: "Buying intent", value: calls[0]?.interestLevel ? `Interest “${calls[0].interestLevel}” on the last call` : "Not known", provenance: calls[0]?.interestLevel ? "user_provided" : "unknown" },
    { label: "Contact permission", value: consents.length ? consents.map((c) => `${c.channel} (${c.purpose})`).join(", ") : "None recorded", provenance: consents.length ? "user_provided" : "unknown" },
  ];
  // Inferences: explicit rules on recorded facts, labelled as guesses.
  const inferred: Fact[] = [];
  if (!l.website) inferred.push({ label: "Online presence", value: "Probably limited (no website listed). Online orders and WhatsApp invoices may be new to them.", provenance: "inferred" });
  if (l.category === "CHAIN") inferred.push({ label: "Plan fit", value: "Multi-branch features (central buying, branch transfers) are likely relevant.", provenance: "inferred" });
  if (l.category === "HOSPITAL") inferred.push({ label: "Plan fit", value: "Hospital pharmacies often need Schedule H1 registers and doctor-wise sales.", provenance: "inferred" });
  if (!l.softwareStatus) inferred.push({ label: "Software need", value: "Unknown. Ask how they bill today and how they track expiry.", provenance: "inferred" });
  else if (["none", "paper"].includes(l.softwareStatus)) inferred.push({ label: "Software need", value: "Likely high: they told us they don’t use billing software.", provenance: "inferred" });
  else if (l.softwareStatus === "other_unhappy") inferred.push({ label: "Software need", value: "Switching may be possible: they said they are unhappy with their current software.", provenance: "inferred" });

  const score = computeScore(await scoreFacts(db, leadId));
  const engaged = calls.some((c) => ["INTERESTED", "DEMO_SCHEDULED", "CONVERTED"].includes(c.outcome ?? ""));
  const qualification = l.stage === "DO_NOT_CONTACT" ? "Do not contact" : score.total >= 60 || engaged ? "Hot" : score.total >= 35 ? "Warm" : "Cold";
  const opportunities = opportunitiesFor(l, inferred);
  return { lead: { id: l.id, code: l.code, name: l.name, stage: l.stage }, facts, inferred, score, qualification, opportunities, followUp: recommendFollowUp(calls.map((c) => ({ outcome: c.outcome as Outcome | null, at: c.reportedAt! })), demos.map((d) => d.status), l.stage) };
}

function opportunitiesFor(l: { category: string; softwareStatus: string; website: string }, inferred: Fact[]) {
  const o = ["GST billing with batch-wise expiry control (FEFO) and expiry alerts", "WhatsApp invoices and refill reminders (with the customer’s consent)", "Works in Hindi and English; offline billing when the internet drops"];
  if (l.category === "CHAIN") o.unshift("Multi-branch: one view of stock, central buying and branch transfers");
  if (["none", "paper"].includes(l.softwareStatus)) o.unshift("Move from paper to billing in minutes: import medicines from Excel");
  if (l.softwareStatus === "other_unhappy") o.unshift("Switching: import medicines, suppliers and customers from the old software’s Excel/CSV export");
  return { list: o.slice(0, 5), note: inferred.length ? "Based on recorded facts and the inferences above; confirm on the call." : "Generic Medoro value points; confirm needs on the call." };
}

/** What to do next, from the call history. Pure. */
export function recommendFollowUp(calls: { outcome: Outcome | null; at: Date }[], demoStatuses: string[], stage: string) {
  if (stage === "DO_NOT_CONTACT") return { action: "Do not contact", when: null as string | null, why: "The pharmacy asked not to be contacted." };
  if (stage === "CONVERTED") return { action: "Hand over to onboarding / customer care", when: null, why: "Already converted." };
  if (demoStatuses.includes("completed") && !["TRIAL_STARTED", "NEGOTIATION"].includes(stage)) return { action: "Offer the 14-day trial", when: "within 2 days", why: "Demo completed; momentum is highest right after it." };
  if (demoStatuses.includes("scheduled")) return { action: "Confirm the demo the day before", when: "1 day before the demo", why: "A reminder reduces no-shows." };
  const last = calls[0];
  if (!last) return { action: "First call", when: "today", why: "Not called yet." };
  const recentNoAnswer = calls.slice(0, 3).filter((c) => c.outcome === "NO_ANSWER" || c.outcome === "BUSY").length;
  switch (last.outcome) {
    case "NO_ANSWER": return recentNoAnswer >= 3 ? { action: "Try a different time of day, or email/WhatsApp if permission exists", when: "in 3 days", why: "Three unanswered attempts in a row." } : { action: "Call again at a different time (pharmacies are quieter 2–4 pm)", when: "tomorrow", why: "No answer last time." };
    case "BUSY": return { action: "Call back", when: "in 2 hours", why: "The line was busy." };
    case "INTERESTED": return { action: "Book a demo", when: "within 3 days", why: "They said they are interested." };
    case "FOLLOW_UP_REQUIRED": return { action: "Call at the time they asked for", when: "as scheduled", why: "They asked for a follow-up." };
    case "CONNECTED": return { action: "Ask how they bill today and offer a short demo", when: "within a week", why: "Spoke, but interest isn’t clear yet." };
    case "NOT_INTERESTED": return { action: "Pause; check in much later only if they agreed", when: "in 60 days", why: "Not interested now." };
    case "WRONG_NUMBER": return { action: "Find the correct number (verification queue)", when: "now", why: "The number was wrong." };
    default: return { action: "Review the lead", when: null, why: outcomeLabel(last.outcome ?? "") };
  }
}

// ── Message drafts: templates filled only with known facts. A person always reviews and sends.
export const draftSchema = z.object({
  leadId: z.string().uuid(),
  lang: z.enum(["en", "hi", "hinglish"]),
  purpose: z.enum(["intro", "followup", "demo_confirm", "after_demo", "call_script"]),
  channel: z.enum(["whatsapp", "email", "call"]).default("whatsapp"),
  polish: z.boolean().default(false),
});

type Vars = { pharmacy: string; city: string; me: string; owner: string; demoAt: string };
const T: Record<z.infer<typeof draftSchema>["purpose"], Record<"en" | "hi" | "hinglish", (v: Vars) => string>> = {
  intro: {
    en: (v) => `Namaste${v.owner ? " " + v.owner : ""}, this is ${v.me} from Medoro. Medoro is pharmacy software for GST billing, batch-wise expiry control and WhatsApp invoices, in Hindi and English. Could I show ${v.pharmacy} a 15-minute demo this week? Reply STOP if you don’t want messages from us.`,
    hi: (v) => `नमस्ते${v.owner ? " " + v.owner + " जी" : ""}, मैं Medoro से ${v.me} बोल रहा/रही हूँ। Medoro मेडिकल स्टोर के लिए सॉफ़्टवेयर है: GST बिलिंग, बैच-वार एक्सपायरी कंट्रोल और WhatsApp पर बिल, हिंदी और अंग्रेज़ी दोनों में। क्या मैं इस हफ़्ते ${v.pharmacy} को 15 मिनट का डेमो दिखा सकता/सकती हूँ? मैसेज नहीं चाहिए तो STOP लिखें।`,
    hinglish: (v) => `Namaste${v.owner ? " " + v.owner + " ji" : ""}, main Medoro se ${v.me} bol raha/rahi hoon. Medoro medical store ke liye software hai: GST billing, batch-wise expiry control aur WhatsApp par bill, Hindi aur English dono mein. Kya main is hafte ${v.pharmacy} ko 15 minute ka demo dikha sakta/sakti hoon? Message nahi chahiye to STOP likhein.`,
  },
  followup: {
    en: (v) => `Namaste${v.owner ? " " + v.owner : ""}, ${v.me} from Medoro again, following up on our conversation about billing software for ${v.pharmacy}. Is this a good time for a short call or demo?`,
    hi: (v) => `नमस्ते${v.owner ? " " + v.owner + " जी" : ""}, Medoro से ${v.me}। ${v.pharmacy} के बिलिंग सॉफ़्टवेयर के बारे में हमारी बात आगे बढ़ाने के लिए संपर्क कर रहा/रही हूँ। क्या अभी छोटी कॉल या डेमो के लिए सही समय है?`,
    hinglish: (v) => `Namaste${v.owner ? " " + v.owner + " ji" : ""}, Medoro se ${v.me}. ${v.pharmacy} ke billing software ke baare mein humari baat aage badhane ke liye message kar raha/rahi hoon. Kya abhi short call ya demo ke liye sahi time hai?`,
  },
  demo_confirm: {
    en: (v) => `Namaste${v.owner ? " " + v.owner : ""}, confirming your Medoro demo for ${v.pharmacy}${v.demoAt ? " on " + v.demoAt : ""}. It takes about 20 minutes. Keep a few medicine names handy and we’ll bill them live. — ${v.me}, Medoro`,
    hi: (v) => `नमस्ते${v.owner ? " " + v.owner + " जी" : ""}, ${v.pharmacy} के लिए आपका Medoro डेमो${v.demoAt ? " " + v.demoAt + " को" : ""} तय है। लगभग 20 मिनट लगेंगे। कुछ दवाइयों के नाम तैयार रखें, हम लाइव बिल बनाकर दिखाएँगे। — ${v.me}, Medoro`,
    hinglish: (v) => `Namaste${v.owner ? " " + v.owner + " ji" : ""}, ${v.pharmacy} ke liye aapka Medoro demo${v.demoAt ? " " + v.demoAt + " ko" : ""} confirm hai. Lagbhag 20 minute lagenge. Kuch dawaiyon ke naam ready rakhein, hum live bill bana kar dikhayenge. — ${v.me}, Medoro`,
  },
  after_demo: {
    en: (v) => `Thank you for your time today${v.owner ? ", " + v.owner : ""}. As discussed, ${v.pharmacy} can start a 14-day free trial of Medoro; we help import your medicine list from Excel. Shall I set it up? — ${v.me}`,
    hi: (v) => `आज समय देने के लिए धन्यवाद${v.owner ? " " + v.owner + " जी" : ""}। जैसा बात हुई, ${v.pharmacy} Medoro का 14 दिन का फ़्री ट्रायल शुरू कर सकता है; आपकी दवाइयों की लिस्ट Excel से हम इम्पोर्ट करवा देंगे। क्या मैं सेटअप कर दूँ? — ${v.me}`,
    hinglish: (v) => `Aaj time dene ke liye dhanyavaad${v.owner ? " " + v.owner + " ji" : ""}. Jaisa baat hui, ${v.pharmacy} Medoro ka 14 din ka free trial shuru kar sakta hai; aapki dawaiyon ki list Excel se hum import karwa denge. Kya main setup kar doon? — ${v.me}`,
  },
  call_script: {
    en: (v) => `1. “Namaste, am I speaking with ${v.pharmacy}${v.city ? " in " + v.city : ""}?” (Confirm it is the pharmacy before going on.)\n2. “I’m ${v.me} from Medoro, pharmacy billing software. Is this a good time for two minutes?” If not, ask when to call back.\n3. Ask: “How do you do billing and track expiry today?” (Record the answer as software status.)\n4. One value point that fits their answer, then: “Can I show you a 15-minute demo?”\n5. If they say not to call again, thank them and mark Do not contact.`,
    hi: (v) => `1. “नमस्ते, क्या मैं ${v.pharmacy}${v.city ? " (" + v.city + ")" : ""} से बात कर रहा/रही हूँ?” (आगे बढ़ने से पहले पक्का करें कि यह वही मेडिकल स्टोर है।)\n2. “मैं Medoro से ${v.me}, मेडिकल स्टोर बिलिंग सॉफ़्टवेयर। क्या दो मिनट बात हो सकती है?” नहीं तो पूछें कब कॉल करें।\n3. पूछें: “अभी बिलिंग और एक्सपायरी कैसे संभालते हैं?” (जवाब सॉफ़्टवेयर स्टेटस में लिखें।)\n4. उनके जवाब से जुड़ा एक फ़ायदा बताएँ, फिर: “क्या 15 मिनट का डेमो दिखा दूँ?”\n5. अगर वे दोबारा कॉल न करने को कहें, धन्यवाद कहें और Do not contact चुनें।`,
    hinglish: (v) => `1. “Namaste, kya main ${v.pharmacy}${v.city ? " (" + v.city + ")" : ""} se baat kar raha/rahi hoon?” (Aage badhne se pehle confirm karein ki yeh wahi medical store hai.)\n2. “Main Medoro se ${v.me}, medical store billing software. Kya do minute baat ho sakti hai?” Nahi to poochein kab call karein.\n3. Poochein: “Abhi billing aur expiry kaise sambhalte hain?” (Jawab software status mein likhein.)\n4. Unke jawab se juda ek fayda batayein, phir: “Kya 15 minute ka demo dikha doon?”\n5. Agar woh dobara call na karne ko kahein, dhanyavaad kahein aur Do not contact chunein.`,
  },
};

export async function draftMessage(a: Actor, raw: z.input<typeof draftSchema>) {
  need(a, "ai.use");
  const i = draftSchema.parse(raw);
  const l = await findLead(a, i.leadId);
  const demo = await db.demoBooking.findFirst({ where: { leadId: l.id, status: "scheduled" }, orderBy: { at: "asc" } });
  const v: Vars = {
    pharmacy: l.name, city: l.city, me: a.name.split(" ")[0], owner: l.ownerVerified ? l.ownerName.split(" ")[0] : "",
    demoAt: demo ? demo.at.toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" }) : "",
  };
  const text = T[i.purpose][i.lang](v);
  const subject = i.channel === "email" ? { en: `Medoro for ${l.name}`, hi: `${l.name} के लिए Medoro`, hinglish: `${l.name} ke liye Medoro` }[i.lang] : "";
  const base = { text, subject, source: "template" as const, notes: ["Uses only recorded facts: pharmacy name, city, your name" + (v.owner ? ", verified owner name" : "") + (v.demoAt ? ", booked demo time" : "") + ".", "Review before sending. Promotional messages need the contact’s consent."] };
  if (!i.polish || i.purpose === "call_script") return base;
  const polished = await polishWithModel(a, text, i.lang);
  return polished ? { ...base, text: polished, source: "model" as const, notes: [...base.notes, "Reworded by the AI model from the template; check it says nothing new."] } : { ...base, notes: [...base.notes, "No AI model is configured or it changed facts, so the template is shown."] };
}

/** Optional rewording by the configured model (AI_MODE local/remote). Rejected if it adds numbers, links or contact details. */
async function polishWithModel(a: Actor, text: string, lang: string): Promise<string | null> {
  const { provider } = resolveProvider(process.env, { strict: false, remoteAi: process.env.GROWTH_REMOTE_AI === "1" });
  if (!provider) return null;
  const rl = await hit({ name: "growthAi", limit: 30, windowSec: 600, what: "AI drafts" }, a.id);
  if (!rl.ok) return null;
  try {
    const r = await chat(provider, [
      { role: "system", content: `Reword the message to sound natural and friendly in ${lang === "hi" ? "Hindi (Devanagari)" : lang === "hinglish" ? "Hinglish (Hindi in Latin script)" : "Indian English"}. Keep every fact exactly; do not add facts, numbers, prices, discounts, claims, links or contact details. Keep the opt-out line. Reply with the message only.` },
      { role: "user", content: text },
    ], [], AbortSignal.timeout(20_000));
    const out = r.content.trim();
    const nums = (s: string) => new Set(s.match(/\d+/g) ?? []);
    const before = nums(text);
    if (!out || out.length > text.length * 2 || [...nums(out)].some((n) => !before.has(n)) || /https?:|www\.|@/.test(out) || (text.includes("STOP") && !out.includes("STOP"))) return null;
    return out;
  } catch { return null; }
}

// ── Objection handling: Medoro's own talking points (from the product), not claims about the pharmacy.
export const OBJECTIONS = {
  price: { en: "Starter is ₹999 a month including GST, and yearly plans are charged for 10 months. Most stores recover it from expiry losses avoided: Medoro warns before batches expire and suggests supplier returns inside the return window.", hi: "Starter प्लान ₹999 महीना (GST सहित) है, और सालाना प्लान में 10 महीने का ही पैसा लगता है। ज़्यादातर स्टोर एक्सपायरी के नुकसान बचाकर ही यह वसूल कर लेते हैं: Medoro बैच एक्सपायर होने से पहले बताता है और सप्लायर रिटर्न सुझाता है।", hinglish: "Starter plan ₹999 mahina (GST ke saath) hai, aur yearly plan mein sirf 10 mahine ka paisa lagta hai. Zyadatar store expiry ka nuksaan bacha kar hi yeh vasool kar lete hain: Medoro batch expire hone se pehle batata hai aur supplier return suggest karta hai." },
  already_using: { en: "No need to start from zero: Medoro imports medicines, suppliers and customers from Excel or CSV exports, and you can try it for 14 days alongside your current software.", hi: "शुरू से शुरू करने की ज़रूरत नहीं: Medoro दवाइयाँ, सप्लायर और ग्राहक Excel/CSV से इम्पोर्ट कर लेता है, और आप 14 दिन अपने मौजूदा सॉफ़्टवेयर के साथ ही आज़मा सकते हैं।", hinglish: "Zero se shuru karne ki zaroorat nahi: Medoro dawaiyan, supplier aur customer Excel/CSV se import kar leta hai, aur aap 14 din apne current software ke saath hi try kar sakte hain." },
  no_time: { en: "Completely understood. The demo is 15 minutes, at a time that suits you, even after closing. When is quieter for you?", hi: "बिल्कुल समझता/समझती हूँ। डेमो सिर्फ़ 15 मिनट का है, आपके सुविधा के समय पर, दुकान बंद होने के बाद भी। आपके लिए कब ठीक रहेगा?", hinglish: "Bilkul samajhta/samajhti hoon. Demo sirf 15 minute ka hai, aapke time par, dukaan band hone ke baad bhi. Aapke liye kab theek rahega?" },
  data_safety: { en: "The pharmacy’s data stays on infrastructure the pharmacy controls, with encrypted backups to your own Google Drive. Medoro staff can’t open your data without a time-limited link you give.", hi: "मेडिकल स्टोर का डेटा आपके ही नियंत्रण वाले सर्वर/ड्राइव पर रहता है, एन्क्रिप्टेड बैकअप आपके अपने Google Drive में। आपकी दी हुई समय-सीमित लिंक के बिना Medoro स्टाफ़ आपका डेटा नहीं खोल सकता।", hinglish: "Medical store ka data aapke hi control wale server/Drive par rehta hai, encrypted backup aapke apne Google Drive mein. Aapki di hui time-limited link ke bina Medoro staff aapka data nahi khol sakta." },
  internet: { en: "Billing keeps working offline on counters you allow: bills get provisional receipts and post automatically when the internet is back.", hi: "आपकी चुनी हुई काउंटर पर बिलिंग बिना इंटरनेट भी चलती है: बिल को अस्थायी रसीद मिलती है और इंटरनेट आने पर अपने-आप पोस्ट हो जाता है।", hinglish: "Aapke chune hue counter par billing bina internet bhi chalti hai: bill ko temporary receipt milti hai aur internet aane par apne aap post ho jata hai." },
  not_tech: { en: "The screens work in Hindi and English, billing is keyboard-first like a register, and we help with setup and the first import.", hi: "स्क्रीन हिंदी और अंग्रेज़ी दोनों में हैं, बिलिंग रजिस्टर की तरह कीबोर्ड से होती है, और सेटअप व पहला इम्पोर्ट हम करवा देते हैं।", hinglish: "Screens Hindi aur English dono mein hain, billing register ki tarah keyboard se hoti hai, aur setup aur pehla import hum karwa dete hain." },
  think: { en: "Of course. Shall I send a short summary on WhatsApp (if that’s alright with you) and call back on a day you choose?", hi: "ज़रूर। अगर आपको ठीक लगे तो WhatsApp पर छोटा सा सारांश भेज दूँ और आपके बताए दिन फिर कॉल करूँ?", hinglish: "Zaroor. Agar aapko theek lage to WhatsApp par chhota sa summary bhej doon aur aapke bataye din phir call karoon?" },
} as const;
export const OBJECTION_LABEL: Record<keyof typeof OBJECTIONS, string> = { price: "Too expensive", already_using: "Already using software", no_time: "No time", data_safety: "Worried about data", internet: "Internet problems", not_tech: "Not comfortable with computers", think: "Need to think" };

export async function demoPrep(a: Actor, leadId: string) {
  need(a, "ai.use");
  const r = await research(a, leadId);
  const calls = await db.callSession.findMany({ where: { leadId, status: "reported" }, orderBy: { reportedAt: "desc" }, take: 5, select: { reportedAt: true, outcome: true, notes: true, interestLevel: true } });
  const heard = (Object.keys(OBJECTIONS) as (keyof typeof OBJECTIONS)[]).filter((k) => calls.some((c) => ({ price: /price|cost|expensive|mehnga|महंगा|paisa/i, already_using: /already|marg|other software|using/i, no_time: /busy|time|samay/i, data_safety: /data|safe|privacy/i, internet: /internet|network|offline/i, not_tech: /computer|tech|difficult/i, think: /think|sochenge|सोच/i })[k].test(c.notes)));
  const agenda = ["Confirm how they bill and track expiry today (2 min)", "Live bill: search by brand or salt, batch picked by earliest expiry, GST invoice, WhatsApp send (6 min)"];
  if (r.lead && r.facts.find((f) => f.label === "Category")?.value === categoryLabel("CHAIN")) agenda.push("Branches: stock across branches, central buying, transfers (4 min)");
  agenda.push("Expiry dashboard and supplier returns (3 min)", "Import from Excel and the 14-day trial (3 min)", "Questions; agree the next step and date (2 min)");
  return { ...r, recentCalls: calls, objectionsHeard: heard.map((k) => ({ key: k, label: OBJECTION_LABEL[k], answer: OBJECTIONS[k].en })), agenda };
}
