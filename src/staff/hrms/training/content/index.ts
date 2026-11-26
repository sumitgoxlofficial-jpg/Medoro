import { PROGRAMME_SLUG } from "../shared";
import { FEATURES } from "./features";
import { CLOSING, COLD_CALLING, COMMUNICATION, CRM, DEMO, DISCOVERY, FEATURES_LESSON, INTRO_MEDORO, OBJECTIONS, OWNERS, PRACTICAL, WELCOME } from "./sales";
import { tourLessons } from "./tour";
import type { Course, Q, Scenario } from "./types";

const FINAL: Q[] = [
  { area: "communication", prompt: "Cold call ka sahi order?", options: ["Price → Pitch → Introduction", "Introduction → Permission → Hook → Discovery → Next step", "Hook → Price → Close", "Discovery → Price → Bye"], answer: 1, explanation: "5-step structure." },
  { area: "communication", prompt: "Pehle 20 second ka hook kis par based hona chahiye?", options: ["Feature list", "Customer ki problem aur ek sawaal", "Discount", "Company ka itihaas"], answer: 1, explanation: "Problem-based hook." },
  { area: "communication", prompt: "Customer: 'Abhi busy hoon.' Best jawaab?", options: ["Pitch jaari rakhein", "'Bilkul Sir, kal 11 baje ya 3 baje theek rahega?'", "Call kaat dein", "'Bas 1 minute' bolkar 10 minute"], answer: 1, explanation: "Specific samay, izzat se." },
  { area: "communication", prompt: "Discovery ka sabse achha sawaal?", options: ["Aap software lenge?", "Aap abhi billing aur expiry kaise manage karte hain?", "Aapka budget kitna hai?", "Aapko discount chahiye?"], answer: 1, explanation: "Open question about current process." },
  { area: "communication", prompt: "Customer GST return ke baare mein poochhe — sahi jawaab?", options: ["Medoro khud file kar dega", "Medoro bills se GSTR-1/3B data aur JSON banata hai; filing se pehle CA check kare", "GST ki zaroorat nahi", "Government approved hai"], answer: 1, explanation: "CA review hamesha." },
  { area: "communication", prompt: "Customer kisi bimaari ke liye dava poochhe?", options: ["Dava bata dein", "Politely: hum software ki baat karte hain; dava ki salaah doctor/pharmacist dete hain", "AI se poochh kar bata dein", "Google karein"], answer: 1, explanation: "Clinical advice kabhi nahi." },
  { area: "communication", prompt: "Schedule H1 compliance par sahi statement?", options: ["Medoro legal compliance guarantee karta hai", "Medoro billing par prescriber check aur H1 register mein madad karta hai; legal zimmedaari pharmacist ki", "Register ki zaroorat khatam", "Inspection nahi hoga"], answer: 1, explanation: "No compliance guarantees." },
  { area: "communication", prompt: "Customer discount maange, koi approved offer nahi hai?", options: ["10% de dein", "'Main apne se discount nahi de sakta; manager se confirm karke bataata hoon'", "Free de dein", "Mana karke call kaat dein"], answer: 1, explanation: "Sirf approved pricing." },
  { area: "communication", prompt: "Demo mein customer ne ek feature poochha jo Medoro mein nahi hai?", options: ["'Haan hai' bol dein", "'Yeh abhi nahi hai' imaandaari se, aur uski asli zaroorat samjhein", "Topic badlein", "Doosri screen dikha kar 'yahi hai' kahein"], answer: 1, explanation: "Never invent features." },
  { area: "communication", prompt: "Demo ka data customer ko kaise samjhayein?", options: ["Yeh kisi asli pharmacy ka data hai", "Yeh demo pharmacy ka kaalpanik data hai; trial mein unka apna data hoga", "Kuch na kahein", "Yeh competitor ka data hai"], answer: 1, explanation: "Demo vs real data." },
  { area: "communication", prompt: "Objection handling formula?", options: ["Bahas → Pressure → Discount", "Suno → Maano → Samjho (sawaal) → Jawaab → Next step", "Ignore → Pitch", "Jhooth → Close"], answer: 1, explanation: "Acknowledge first." },
  { area: "communication", prompt: "Inmein buying signal kaunsa hai?", options: ["'Mujhe zaroorat nahi'", "'Hamara purana stock data aa jaayega?'", "'Baad mein call karo'", "'Busy hoon'"], answer: 1, explanation: "Implementation question." },
  { area: "communication", prompt: "Security par kaunsa claim allowed hai?", options: ["'100% unhackable'", "'Data aapke apne Google Drive mein, aapki key se encrypted; two-step login'", "'Kabhi kuch nahi hoga'", "'Government certified security'"], answer: 1, explanation: "Sirf tathya." },
  { area: "crm", prompt: "Har call ke baad CRM mein sabse zaroori kya hai?", options: ["Kuch nahi", "Call note aur agla follow-up", "Lead delete", "Sirf naam badalna"], answer: 1, explanation: "Next step tracked." },
  { area: "crm", prompt: "Demo book hua — Lead Tracker par stage?", options: ["New", "Demo booked", "Won", "Lost"], answer: 1, explanation: "Stages: New → Contacted → Demo booked → Trial → Won/Lost." },
  { area: "crm", prompt: "Lead ko Lost karte waqt kya zaroori hai?", options: ["Kuch nahi", "Lost ka kaaran chunna", "Customer ki permission", "Lead delete"], answer: 1, explanation: "Lost reason required." },
  { area: "crm", prompt: "Lead ko 'Won' kab mark karein?", options: ["Customer ne 'sochenge' kaha", "Sach mein conversion/payment hone par", "Target poora karne ke liye", "Demo ke baad"], answer: 1, explanation: "Won logs the sale and commission — never fake it." },
  { area: "crm", prompt: "Daily report mein kya hona chahiye?", options: ["Calls, demos, trials, won/lost (kaaran), kal ke follow-ups", "Customer ke passwords", "Sirf 'sab theek'", "Competitor ki burai"], answer: 0, explanation: "Activity that matches CRM." },
];

const SCENARIOS: Scenario[] = [
  { slug: "manual-register", title: "Small pharmacy using manual registers", persona: "Ramesh Gupta, Gupta Medical (1 counter, ~60 bills/din), sab register mein.", situation: "Owner busy hai, software ko 'jhanjhat' samajhta hai. Expiry ka pata der se chalta hai.", script: [{ who: "customer", text: "Haan boliye, jaldi boliye, customer khade hain." }, { who: "customer", text: "Hum register mein likhte hain, kaam chal jaata hai." }, { who: "customer", text: "Software mein bahut time lagta hai seekhne mein." }, { who: "coach", text: "Goal: samay ki izzat, ek problem (expiry/udhaar) dhoondhna, Hindi interface aur simple billing, aur demo/callback ka specific samay." }], goals: ["Permission + short hook", "Expiry ya udhaar ki problem nikaalna", "Hindi + keyboard billing se 'mushkil' ka jawaab", "Callback/demo ka specific samay"] },
  { slug: "other-software", title: "Pharmacy already using another software", persona: "Sunita Verma, Verma Pharmacy (2 counters), 3 saal se doosra billing software.", situation: "Current software se theek-thaak khush; badalne ka risk nahi lena chahti.", script: [{ who: "customer", text: "Hum already software use kar rahe hain." }, { who: "customer", text: "Data shift karna bahut bada kaam hai." }, { who: "customer", text: "Aapke mein naya kya hai?" }, { who: "coach", text: "Goal: competitor ki burai nahi; gap dhoondhna (expiry, offline, GST export, Drive backup); Excel import; trial se compare." }], goals: ["Respect current choice", "Gap-finding question", "Excel/CSV import honestly", "Trial ya targeted demo"] },
  { slug: "price-concern", title: "Customer concerned about pricing", persona: "Imran Khan, City Medicos (1 branch, 3 counters).", situation: "Interested hai par 'mehenga hai' bol raha hai aur discount maang raha hai.", script: [{ who: "customer", text: "Feature achhe hain, par bahut mehenga hai." }, { who: "customer", text: "Kuch discount do to abhi le leta hoon." }, { who: "customer", text: "Doosra wala aadhe mein de raha hai." }, { who: "coach", text: "Goal: compare ka sawaal, size ke hisaab se plan, sirf approved price/offer, apne se discount nahi, trial se value." }], goals: ["Acknowledge without arguing", "Right-size plan", "No unapproved discount", "Trial / next step"] },
  { slug: "low-tech", title: "Customer with limited technical knowledge", persona: "Shanti Devi, Shanti Medical Store; beta kabhi-kabhi help karta hai.", situation: "Computer kam chalati hain; English screens se ghabraati hain.", script: [{ who: "customer", text: "Mujhe computer zyada nahi aata." }, { who: "customer", text: "Sab English mein hoga na?" }, { who: "customer", text: "Kuch galat daba diya to sab kharab ho jaayega?" }, { who: "coach", text: "Goal: dheere aur simple bhaasha; Hindi interface; F2-Enter-F9; returns/credit note se bill kabhi delete nahi; demo beta ke saath." }], goals: ["Simple language, patience", "Hindi switch", "Reassure with real safeguards", "Demo with family member"] },
  { slug: "expiry-inventory", title: "Pharmacy owner with inventory and expiry problems", persona: "Dr. Anil Mehta, Mehta Pharma (2 counters, ~180 bills/din).", situation: "Har mahine maal expire hota hai; stock register aur shelf match nahi karte.", script: [{ who: "customer", text: "Sabse badi problem expiry hai, har mahine nuksaan." }, { who: "customer", text: "Stock bhi kabhi match nahi karta." }, { who: "customer", text: "Kya aapka software nuksaan zero kar dega?" }, { who: "coach", text: "Goal: FEFO, 90-day expiry list, stock count, supplier claims; 'zero' ki guarantee nahi — 'kam karne mein madad'." }], goals: ["Deep discovery on expiry", "FEFO + expiry list + claims", "No guarantee", "Demo booked"] },
  { slug: "multi-branch", title: "Multi-branch pharmacy owner", persona: "Rajiv Malhotra, LifeCare Pharmacy (3 branches).", situation: "Har shaam branches ko call karta hai; transfers ka record nahi.", script: [{ who: "customer", text: "Teen branches hain, sab alag chalti hain." }, { who: "customer", text: "Mujhe ghar baithe sab dekhna hai." }, { who: "customer", text: "Kitni branches tak chalega?" }, { who: "coach", text: "Goal: Owner view (phone), transfers, branch-wise dashboard; Multi-branch plan limits (5 branches, add-on) sahi bataana." }], goals: ["Branch discovery", "Owner view + transfers", "Accurate plan limits", "Demo with owner"] },
  { slug: "partner-approval", title: "Interested customer who needs partner approval", persona: "Pooja Sharma, Sharma & Sons Medical; partner bhai decide karte hain.", situation: "Pooja ko pasand aaya par partner ke bina decide nahi kar sakti.", script: [{ who: "customer", text: "Mujhe achha laga, par bhaiya se poochhna padega." }, { who: "customer", text: "Aap details WhatsApp kar do." }, { who: "customer", text: "Woh price zaroor poochhenge." }, { who: "coach", text: "Goal: decision process samajhna, joint demo book karna, partner ki chinta poochhna, permission se relevant details, CRM follow-up." }], goals: ["Understand decision maker", "Joint demo", "Partner's concerns", "Follow-up recorded"] },
];

/** The standard one-day Medoro Sales Academy, as installed by HR. */
export function standardCourse(): Course {
  const tour = tourLessons();
  return {
    slug: PROGRAMME_SLUG,
    title: "Medoro Sales Training Academy",
    description: "One-day programme for new Medoro Sales Executives: Medoro and its customers, the official 26-chapter product tour, feature-to-benefit selling, communication, cold calling, discovery, demonstrations, objection handling, closing, CRM, a mock sales call, a demo assessment and a final exam.",
    sessions: [
      { start: "10:00", end: "10:15", title: "Welcome to Medoro Sales Academy", kind: "session", moduleSlug: "welcome" },
      { start: "10:15", end: "10:45", title: "Introduction to Medoro", kind: "session", moduleSlug: "intro" },
      { start: "10:45", end: "11:15", title: "Pharmacy Industry and Customer Problems", kind: "session", moduleSlug: "industry" },
      { start: "11:15", end: "12:10", title: "Complete Medoro Pharmacy Product Tour", kind: "session", moduleSlug: "tour" },
      { start: "12:10", end: "12:35", title: "Product Features and Customer Benefits", kind: "session", moduleSlug: "features" },
      { start: "12:35", end: "13:00", title: "Product Knowledge Quiz", kind: "quiz" },
      { start: "13:00", end: "13:30", title: "Lunch Break", kind: "break" },
      { start: "13:30", end: "14:00", title: "Sales Mindset and Professional Communication", kind: "session", moduleSlug: "communication" },
      { start: "14:00", end: "14:45", title: "Cold Calling and Opening Hooks", kind: "session", moduleSlug: "cold-calling" },
      { start: "14:45", end: "15:15", title: "Customer Discovery and Requirement Analysis", kind: "session", moduleSlug: "discovery" },
      { start: "15:15", end: "15:45", title: "Product Demonstration Training", kind: "session", moduleSlug: "demo" },
      { start: "15:45", end: "16:00", title: "Short Break", kind: "break" },
      { start: "16:00", end: "16:45", title: "Customer Objection Handling", kind: "session", moduleSlug: "objections" },
      { start: "16:45", end: "17:15", title: "Negotiation and Sales Closing", kind: "session", moduleSlug: "closing" },
      { start: "17:15", end: "17:45", title: "CRM, Lead Management and Reporting", kind: "session", moduleSlug: "crm" },
      { start: "17:45", end: "18:15", title: "Practical Examination and Mock Sales Calls", kind: "practical", moduleSlug: "practical" },
      { start: "18:15", end: "18:30", title: "Final Assessment and Feedback", kind: "assessment" },
    ],
    modules: [
      { slug: "welcome", title: "Welcome to Medoro Sales Academy", kind: "intro", description: "How the day works and how certification is earned.", lessons: [WELCOME] },
      { slug: "intro", title: "Introduction to Medoro", kind: "intro", description: "What Medoro is, who it is for, and how to introduce the company with trust.", lessons: [INTRO_MEDORO] },
      { slug: "industry", title: "Pharmacy Industry and Customer Problems", kind: "sales", description: "Small, medium and multi-branch pharmacies and their real problems.", lessons: [OWNERS] },
      { slug: "tour", title: "Medoro Pharmacy – Complete Product Knowledge", kind: "tour", description: "The official 26-chapter product tour (medoro.in/videos/complete-product-tour), embedded unchanged, with sales notes for every chapter. Recorded on a demo pharmacy with made-up data.", lessons: tour.lessons },
      { slug: "features", title: "Product Features and Customer Benefits", kind: "product", description: "Feature-to-benefit training for 25 features.", lessons: [{ ...FEATURES_LESSON, content: { ...FEATURES_LESSON.content, features: FEATURES } }] },
      { slug: "communication", title: "Sales Mindset and Professional Communication", kind: "sales", description: "Tone, confidence, listening and trust.", lessons: [COMMUNICATION] },
      { slug: "cold-calling", title: "Cold Calling and Opening Hooks", kind: "sales", description: "Call structure, permission, hooks, busy customers, demo requests and six scripts.", lessons: [COLD_CALLING] },
      { slug: "discovery", title: "Customer Discovery and Requirement Analysis", kind: "sales", description: "Questions before pitching, and mapping needs to features.", lessons: [DISCOVERY] },
      { slug: "demo", title: "Product Demonstration Training", kind: "sales", description: "Preparing and running a demo on the real software.", lessons: [DEMO] },
      { slug: "objections", title: "Customer Objection Handling", kind: "sales", description: "The objection library: twelve real objections.", lessons: [OBJECTIONS] },
      { slug: "closing", title: "Negotiation and Sales Closing", kind: "sales", description: "Intent, value, pricing questions, next steps and follow-up.", lessons: [CLOSING] },
      { slug: "crm", title: "CRM, Lead Management and Reporting", kind: "sales", description: "Leads, notes, stages, follow-ups, conversions, lost reasons and daily reports.", lessons: [CRM] },
      { slug: "practical", title: "Practical Examination and Mock Sales Calls", kind: "practice", description: "How the mock call and demo assessment are scored.", lessons: [PRACTICAL] },
    ],
    productQuiz: tour.product,
    finalExam: FINAL,
    scenarios: SCENARIOS,
  };
}
