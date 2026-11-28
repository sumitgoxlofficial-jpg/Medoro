// Understanding what an employee said, in Hindi (Devanagari), English or Hinglish (romanised Hindi mixed with English).
// Pure and deterministic: no model, no I/O. The dialog engine uses it every turn; the scenario evaluation measures it.
// A local model may be asked to classify an utterance the rules can't place (see engine.ts), but its answer must pass
// the same schema and is never trusted for safety intents (stop, human, harassment, emergency), which are rules only.

export type Lang = "hi" | "en" | "hinglish";
export const INTENTS = [
  "harassment", "accident", "emergency", "stop_calls", "human", "ai_identity", "recording", "privacy",
  "complaint", "dont_know", "attendance_dispute", "not_scheduled", "why_call", "already_checked_in", "attendance_issue", "leave_applied", "want_leave", "half_day", "wfh", "absent", "coming",
  "still_working", "forgot_checkout", "left_early", "overtime_accept", "overtime_reject", "overtime_clarify",
  "policy_question", "payroll_question", "busy", "callback", "confused", "repeat", "yes", "no", "greeting", "thanks", "goodbye", "unrelated", "unknown",
] as const;
export type Intent = (typeof INTENTS)[number];
export const REASONS = [
  "traffic", "public_transport", "vehicle", "weather", "illness", "medical", "family", "emergency", "personal", "attendance_system", "work", "other",
] as const;
export type ReasonCategory = (typeof REASONS)[number];
export const TONES = ["angry", "busy", "confused", "worried", "urgent", "uncomfortable", "calm"] as const;
export type Tone = (typeof TONES)[number];

export type Slots = {
  /** Expected arrival / finish time, HH:MM India time. */
  eta?: string;
  reason?: ReasonCategory;
  /** When to call back: HH:MM, or "tomorrow", "tomorrow HH:MM", "evening", "later". */
  callback?: string;
  /** Time the person says they left / will leave, HH:MM. */
  leftAt?: string;
};
export type Nlu = { lang: Lang; intents: Intent[]; primary: Intent; slots: Slots; tones: Tone[]; confidence: number; text: string };

// ── Normalisation
const DEV_DIGITS = "०१२३४५६७८९";
export function normalise(raw: string): string {
  let t = String(raw ?? "").toLowerCase();
  t = t.replace(/[०-९]/g, (d) => String(DEV_DIGITS.indexOf(d)));
  t = t.replace(/\u0901/g, "\u0902").replace(/\u093C/g, "");
  t = t.replace(/\.{2,}|…/g, " ");
  t = t.replace(/[’‘`]/g, "'").replace(/[“”]/g, '"');
  t = t.replace(/[^\p{L}\p{M}\p{N}:.'?!\s-]/gu, " ").replace(/\s+/g, " ").trim();
  return t;
}
const B = "(?<![\\p{L}\\p{M}\\p{N}])", E = "(?![\\p{L}\\p{M}\\p{N}])";
/** A regex matching any of the phrases as whole words (Devanagari-safe). Phrases are regex fragments. */
const normAlt = (a: string) => a.replace(/\u0901/g, "\u0902").replace(/\u093C/g, "");
const w = (...alts: string[]) => new RegExp(`${B}(?:${alts.map(normAlt).join("|")})${E}`, "u");
const any = (t: string, ...res: RegExp[]) => res.some((r) => r.test(t));

const HINDI_WORDS = w("hai", "hain", "hoon", "hun", "hu", "nahi", "nahin", "nhi", "kya", "aap", "main", "mein", "mai", "raha", "rahi", "rha", "rhi", "aaj", "kal", "baje", "bje", "ghante", "ghanta", "kar", "karo", "karna", "karunga", "karungi", "jaunga", "jaungi", "aunga", "aaunga", "aaungi", "theek", "thik", "haan", "han", "ji", "bhai", "abhi", "baad", "wala", "kuch", "kaise", "kyun", "mujhe", "mera", "meri", "gaya", "gayi", "tha", "thi", "lunga", "lungi", "chahiye", "paunga", "paungi", "sakta", "sakti", "bolo", "boliye", "chhutti", "chutti", "tabiyat", "ghar", "bahut", "thoda", "thodi", "der", "pahunch", "dunga", "dungi", "matlab", "samajh", "lekin", "par", "toh", "to", "bhi", "se", "ko", "ka", "ki", "ke");
const ENGLISH_ONLY = w("the", "i", "i'm", "im", "am", "will", "would", "can", "could", "please", "today", "office", "reach", "coming", "late", "leave", "sorry", "my", "is", "are", "was", "have", "been", "by", "at", "in", "on", "for", "not", "don't", "can't", "won't", "yes", "no", "okay", "ok");

export function detectLang(raw: string): Lang {
  const s = String(raw ?? "");
  const dev = (s.match(/[ऀ-ॿ]/g) ?? []).length, lat = (s.match(/[a-z]/gi) ?? []).length;
  if (dev > 0 && dev >= lat) return "hi";
  const t = normalise(s);
  const words = t.split(" ").filter(Boolean);
  const hindiHits = words.filter((x) => HINDI_WORDS.test(x)).length;
  if (dev > 0) return "hinglish";
  if (hindiHits === 0 && words.some((x) => ENGLISH_ONLY.test(x))) return "en";
  if (hindiHits === 0 && words.length <= 2) return "en";
  return hindiHits / Math.max(1, words.length) >= 0.12 ? "hinglish" : "en";
}

// ── Time
const NUM: Record<string, number> = {
  ek: 1, one: 1, एक: 1, do: 2, two: 2, दो: 2, teen: 3, tin: 3, three: 3, तीन: 3, char: 4, chaar: 4, four: 4, चार: 4, paanch: 5, panch: 5, five: 5, पांच: 5, पाँच: 5,
  chhe: 6, che: 6, chhah: 6, six: 6, छह: 6, छः: 6, saat: 7, sat: 7, seven: 7, सात: 7, aath: 8, ath: 8, eight: 8, आठ: 8, nau: 9, nine: 9, नौ: 9,
  das: 10, ten: 10, दस: 10, gyarah: 11, gyara: 11, eleven: 11, ग्यारह: 11, barah: 12, bara: 12, twelve: 12, बारह: 12,
  pandrah: 15, pandra: 15, fifteen: 15, पंद्रह: 15, bees: 20, twenty: 20, बीस: 20, pachchis: 25, pachis: 25, tees: 30, thirty: 30, तीस: 30, chalis: 40, forty: 40, pachas: 50, pachaas: 50,
};
const numOf = (s: string): number | null => (/^\d+$/.test(s) ? Number(s) : NUM[s] ?? null);
const NUMW = `\\d{1,3}|${Object.keys(NUM).join("|")}`;
export const clock = (m: number) => { const x = ((Math.round(m) % 1440) + 1440) % 1440; return `${String(Math.floor(x / 60)).padStart(2, "0")}:${String(x % 60).padStart(2, "0")}`; };
export const toMin = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** Resolve an hour given without am/pm to the sensible clock time: the next one not long before now. */
function resolveHour(h: number, m: number, nowMin: number, part: "am" | "pm" | "night" | "nightshift" | null): number {
  if (part === "nightshift") return (h <= 9 ? h : h < 12 ? h + 12 : h === 12 ? 0 : h) * 60 + m; // a night shift ends in the morning
  if (part === "night") return (h <= 5 || h === 12 ? h % 12 : h < 12 ? h + 12 : h) * 60 + m;
  if (part === "pm" && h < 12) h += 12;
  if (part === "am" && h === 12) return 12 * 60 + m;
  if (part || h > 12) return h * 60 + m;
  const c1 = (h % 12) * 60 + m + (h === 12 ? 720 : 0), c2 = (h % 12 + 12) * 60 + m;
  if (h === 12) return c1;
  return c1 >= nowMin - 90 ? c1 : c2;
}
const dayPart = (t: string): "am" | "pm" | "night" | null =>
  any(t, w("raat", "night", "रात")) && !any(t, w("pm", "p\\.m\\.")) ? "night"
  : any(t, w("pm", "p\\.m\\.", "shaam", "sham", "shaam ko", "raat", "evening", "night", "afternoon", "dopahar", "dopehar", "शाम", "रात", "दोपहर")) ? "pm"
    : any(t, w("am", "a\\.m\\.", "subah", "morning", "सुबह")) ? "am" : null;

/** A clock time or a relative time ("20 minute mein", "aadhe ghante", "by 11:30", "साढ़े दस बजे"). */
export function parseTime(raw: string, nowMin: number): { at: string; relative: boolean } | null {
  const t = normalise(raw);
  let part: ReturnType<typeof dayPart> | "nightshift" = null;
  const near = (m: RegExpMatchArray | null) => { if (m && m.index !== undefined) part = dayPart(t.slice(Math.max(0, m.index - 14), m.index + m[0].length + 10)); };
  const nightCtx = any(t, w("night shift", "raat ki shift", "night duty", "nightshift"));
  // Relative: "20 min mein", "aadhe ghante", "half an hour", "dedh ghanta", "an hour"
  if (any(t, w("aadhe ghante", "aadha ghanta", "adhe ghante", "aadhe ghante mein", "half an hour", "half hour", "30 min", "आधे घंटे", "आधा घंटा"))) return { at: clock(nowMin + 30), relative: true };
  if (any(t, w("dedh ghanta", "dedh ghante", "dedh ghante mein", "an hour and a half", "one and a half hours?", "डेढ़ घंटे", "डेढ़ घंटा"))) return { at: clock(nowMin + 90), relative: true };
  if (any(t, w("paune ghante", "45 min", "forty five minutes"))) return { at: clock(nowMin + 45), relative: true };
  const rel = t.match(new RegExp(`${B}(${NUMW}|an|a)\\s*(minutes?|mins?|minat|mnt|मिनट|ghante|ghanta|ghnte|hours?|hrs?|घंटे|घंटा)${E}`, "u"));
  if (rel) {
    const n = rel[1] === "an" || rel[1] === "a" ? 1 : numOf(rel[1]);
    const unit = /^(gh|h|घ)/.test(rel[2]) ? 60 : 1;
    // "10 minute late" is how late, not an ETA, but both mean the same thing relative to now
    if (n !== null && n > 0 && n * unit <= 12 * 60) return { at: clock(nowMin + n * unit), relative: true };
  }
  if (any(t, w("thodi der mein", "thodi der me", "bas pahunch", "almost there", "5 min", "paanch minute", "pahunchne wala", "pahunchne wali", "just reaching", "बस पहुंच"))) return { at: clock(nowMin + 10), relative: true };
  // "dedh baje", "dhai baje"
  near(t.match(/(dedh|dhai|dhaai|डेढ|ढाई) baje|(dedh|dhai|डेढ|ढाई) बजे/u));
  if (any(t, w("dedh baje", "डेढ़ बजे"))) return { at: clock(resolveHour(1, 30, nowMin, part)), relative: false };
  if (any(t, w("dhai baje", "dhaai baje", "ढाई बजे"))) return { at: clock(resolveHour(2, 30, nowMin, part)), relative: false };
  // HH:MM or HH.MM
  const hm = t.match(/(?<![\d.:])([01]?\d|2[0-3])[:.]([0-5]\d)(?![\d])/);
  near(hm); if (!part && nightCtx) part = "nightshift";
  if (hm) return { at: clock(resolveHour(Number(hm[1]), Number(hm[2]), nowMin, part)), relative: false };
  // "sadhe 10 baje", "sawa 11", "paune 12", "11 baje", "by 11", "11 tak", "around 11 am"
  const mod = normAlt(`(?:(saadhe|sadhe|sade|साढ़े|sawa|sava|सवा|paune|pone|पौने|half past|quarter past|quarter to)\\s+)?`);
  const suffix = `(baje|bje|बजे|o'?clock|am|pm|a\\.m\\.|p\\.m\\.|tak|तक|ke aas paas|ke around|ke aaspaas)`;
  let m = t.match(new RegExp(`${B}${mod}(${NUMW})\\s*${suffix}`, "u"));
  if (!m) m = t.match(new RegExp(`${B}(?:by|around|at|till|until|before|approx|approximately|takriban|lagbhag|लगभग)\\s+${mod}(${NUMW})${E}`, "u"));
  near(m); if (!part && nightCtx) part = "nightshift";
  if (m) {
    const h = numOf(m[2]);
    if (h !== null && h >= 0 && h <= 23) {
      const md = m[1] ?? "";
      let hh = h, mm = 0;
      if (/^(saadhe|sadhe|sade|साढ़े|साढे|half past)$/u.test(md)) mm = 30;
      else if (/^(sawa|sava|सवा|quarter past)$/.test(md)) mm = 15;
      else if (/^(paune|pone|पौने|quarter to)$/.test(md)) { hh = h - 1; mm = 45; }
      return { at: clock(resolveHour(hh, mm, nowMin, part)), relative: false };
    }
  }
  return null;
}

// ── Lexicon
const NEG = "(?:nahi|nahin|nhi|nai|na|mat|nahii|नहीं|नही|ना|मत|not|never|can't|cannot|won't|don't|unable)";
const L = {
  yes: w("haan", "han", "haa", "ha", "hanji", "haanji", "haan ji", "ji haan", "ji", "jee", "yes", "yeah", "yep", "yup", "sure", "ok", "okay", "theek hai", "thik hai", "theek", "thik", "bilkul", "zaroor", "jarur", "of course", "correct", "sahi", "sahi hai", "right", "haan bolo", "ji bolo", "bolo", "boliye", "chalega", "kar sakte hain", "हाँ", "हां", "जी", "जी हाँ", "ठीक है", "बिल्कुल", "सही", "बोलिए"),
  no: w("nahi", "nahin", "nhi", "nai", "naa", "no", "nope", "nah", "not really", "नहीं", "नही", "ना"),
  coming: w("aa raha", "aa rahi", "aa rha", "aa rhi", "aa raha hoon", "aa rahi hoon", "aaunga", "aaungi", "aunga", "aungi", "aa jaunga", "aa jaungi", "aa jaaunga", "aa jaaungi", "aa jaenge", "pahunch jaunga", "pahunch jaungi", "pahunchunga", "pahunchungi", "pahuch jaunga", "pohoch jaunga", "pahunch raha", "pahunch rahi", "will reach", "reaching", "coming", "on my way", "on the way", "raste mein", "raste me", "rastey mein", "nikal gaya hoon", "nikal gayi hoon", "nikal chuka", "nikal chuki", "nikla hoon", "nikal raha", "nikal rahi", "will be there", "be there", "i'll come", "i will come", "running late", "aata hoon", "aati hoon", "abhi aata", "abhi aati", "late", "late hoon", "late hoga", "late ho jaunga", "late ho jaungi", "late ho raha", "late ho rahi", "thoda late", "थोड़ा लेट", "आ रहा", "आ रही", "आऊंगा", "आऊंगी", "आ जाऊंगा", "आ जाऊंगी", "पहुंच जाऊंगा", "पहुंच जाऊंगी", "पहुँच जाऊँगा", "रास्ते में", "निकल गया", "निकल गई", "लेट"),
  absent: [new RegExp(`${B}(?:aaj\\s+)?(?:office\\s+)?${NEG}\\s+(?:aa|aaa|a)\\s*(?:paunga|paungi|paaunga|paaungi|sakta|sakti|saktA|raha|rahi|rha|rhi|unga|ungi|aunga|aungi|payenge|paayenge)${E}`, "u"),
    w("aana possible nahi", "aana mumkin nahi", "aana mushkil hai", "aana nahi ho payega", "aana nahi ho paayega", "aa nahi paunga", "aa nahi paungi", "aa nahi sakta", "aa nahi sakti", "won't be able to come", "will not be able to come", "not be able to come", "kal aaunga", "kal aaungi", "kal aa jaunga", "kal aa jaungi", "can't come", "cannot come", "won't come", "won't be coming", "not coming", "unable to come", "can't make it", "cannot make it", "won't make it", "not be able to come", "nahi aaunga", "nahi aaungi", "nahi aaoonga", "nahi aunga", "nahi aungi", "absent", "aaj off", "aaj nahi aa", "nahi aa paunga", "नहीं आ पाऊंगा", "नहीं आ पाऊंगी", "नहीं आऊंगा", "नहीं आऊंगी", "नहीं आ सकता", "नहीं आ सकती")],
  leaveApplied: [w("leave apply kar di", "leave apply kar diya", "leave apply ki", "leave apply kiya", "leave applied", "applied leave", "applied for leave", "applied for a leave", "already applied", "request already gayi", "already gayi hui", "gayi hui hai", "request gayi hui", "leave daal di", "leave daal diya", "leave dal di", "leave dali", "leave lagayi", "leave laga di", "leave le rakhi", "chhutti le rakhi", "chutti le rakhi", "leave request daal", "leave request bhej", "request daal di", "application de di", "application di thi", "leave pending hai", "leave approved hai", "leave approve ho gayi", "already on leave", "i am on leave", "i'm on leave", "on leave today", "leave pe hoon", "leave par hoon", "छुट्टी ले रखी", "लीव अप्लाई", "छुट्टी पर हूँ", "छुट्टी पर हूं"), /(leave|chhutti|chutti|छुट्टी|लीव|comp off|comp-off)[^.?!]{0,30}(pending|approved|approve ho|approve hua|approve hui|approve kar di|le rakha|le rakhi|मंज़ूर|अप्रूव)/u, /(approved|pending)[^.?!]{0,12}(leave|chhutti)/u, /(leave|chhutti|chutti|छुट्टी|लीव)[^.?!]{0,25}(apply|applied|daal|dal|lag|bhej|submit|अप्लाई|डाल)[^.?!]{0,12}(kar|ki|kiya|diya|di|hai|chuka|chuki|tha|thi|done|already|दी|दिया|है)/u],
  wantLeave: w("leave chahiye", "leave lena", "leave leni", "leave le lunga", "leave le lungi", "leave lena hai", "leave le leta", "leave de do", "leave mark", "leave laga do", "chhutti chahiye", "chutti chahiye", "chhutti lena", "chutti lena", "chhutti le lunga", "chutti le lungi", "chhutti de do", "take leave", "take a leave", "sick day", "take a sick day", "take a day", "personal day", "take the day off", "take a day off", "day off", "need leave", "need a leave", "want leave", "want to take leave", "apply leave", "sick leave", "casual leave", "leave le sakta", "leave le sakti", "छुट्टी चाहिए", "छुट्टी लेनी", "छुट्टी ले लूंगा", "छुट्टी ले लूंगी", "लीव चाहिए"),
  halfDay: w("half day", "half-day", "halfday", "aadha din", "aadhe din", "second half", "first half", "post lunch", "lunch ke baad", "आधा दिन", "हाफ डे"),
  wfh: w("wfh", "work from home", "working from home", "ghar se kaam", "ghar se karunga", "ghar se karungi", "ghar se kar", "remote", "remotely", "online kaam", "online kar", "घर से काम"),
  checkedInRe: /reach[^.?!]{0,20}(kar liya|kar gaya|kar gayi|ho gaya|kiya tha)/u,
  checkedIn: w("check in kar liya", "check in kar li", "checkin kar liya", "checkin kar li", "check-in kar liya", "check in kiya tha", "check in kar diya", "check in ho gaya", "punch kar diya", "punch kiya tha", "already checked in", "checked in", "i checked in", "desk pe hoon", "desk par hoon", "main to desk", "seat par hoon", "reach kar liya", "reach ho gaya", "reach kar gaya", "reached", "i'm in the office", "i am in the office", "in the office already", "andar hoon", "main andar", "office mein hoon", "office me hoon", "office mein hu", "office me hu", "office pahunch gaya", "office pahunch gayi", "pahunch gaya hoon", "pahunch gayi hoon", "pahunch gaya", "pahunch gayi", "reached office", "i have reached", "already reached", "i am in office", "i'm in office", "already in office", "at my desk", "seat pe hoon", "ऑफिस में हूँ", "ऑफिस में हूं", "पहुंच गया", "पहुंच गई", "पहुँच गया", "चेक इन कर लिया"),
  attIssueRe: /(check ?-?in|button|app|machine|biometric|scanner|device|punch)[^.?!]{0,20}(kaam nahi|nahi chal|not working|isn't working|band hai|error|fail)/u,
  attIssue: w("biometric", "machine kharab", "machine nahi", "thumb", "finger", "fingerprint", "punch nahi", "punch nahi hua", "otp nahi", "otp nahi aa raha", "login nahi", "login issue", "login problem", "can't log in", "cannot login", "password bhool", "password issue", "app nahi khul", "app not opening", "app crash", "app band", "gps", "location", "location permission", "network nahi", "network issue", "internet nahi", "internet issue", "no network", "server down", "site nahi khul", "hrms nahi khul", "hrms down", "record nahi hua", "show nahi ho raha", "not showing", "sync", "बायोमेट्रिक", "लॉगिन", "नेटवर्क"),
  stillWorkingRe: [/tak\s+(kaam|duty|office)/u, /(duty|shift)\s+(chal rahi|chal raha|pe hoon|par hoon)/u],
  stillWorking: w("night duty", "on duty", "duty pe hoon", "duty par hoon", "kaam hai abhi", "abhi bhi kaam", "abhi kaam kar raha", "abhi kaam kar rahi", "kaam chal raha", "kaam kar raha hoon", "kaam kar rahi hoon", "still working", "still at work", "working late", "still in office", "abhi office mein", "abhi office me", "office mein hi hoon", "ruk ke kaam", "kaam baaki", "kaam khatam nahi", "late tak", "der tak", "अभी काम", "काम कर रहा", "काम कर रही", "अभी ऑफिस में"),
  forgotGeneric: w("bhool gaya", "bhool gayi", "bhul gaya", "bhul gayi", "bhool gya", "forgot", "forget", "reh gaya", "rah gaya", "miss ho gaya", "भूल गया", "भूल गई"),
  forgotOut: [w("nikal gaya tha", "nikal gayi thi", "ghar aa gaya", "ghar aa gayi", "ghar pahunch gaya", "ghar pahunch gayi", "ghar pe hoon", "ghar par hoon", "left office", "already left", "i left", "went home", "left at", "घर आ गया", "घर आ गई"), /(check ?-?out|checkout|punch out|चेकआउट|चेक आउट)[^.?!]{0,20}(nahi kiya|nahi kar|nahi hua|bhool|bhul|miss|reh|rah|forgot)/u],
  leftEarly: w("early nikal", "jaldi nikal", "left early", "early chala", "jaldi chala", "jaldi gaya", "jaldi gayi", "जल्दी निकल"),
  otAccept: w("kar lunga", "kar lungi", "kar dunga", "kar dungi", "kar sakta hoon", "kar sakti hoon", "available hoon", "available hu", "main available", "i am available", "i'm available", "i can do", "i can do it", "i will do", "i'll do", "i can stay", "count me in", "ruk jaunga", "ruk jaungi", "ruk sakta", "ruk sakti", "ruk jaata", "ho jayega", "ho jaayega", "chalega", "done", "accept", "accepted", "रुक जाऊंगा", "रुक जाऊंगी", "कर लूंगा", "कर लूंगी"),
  otReject: [w("nahi kar paunga", "nahi kar paungi", "nahi kar sakta", "nahi kar sakti", "nahi ruk paunga", "nahi ruk paungi", "nahi ruk sakta", "nahi ruk sakti", "can't stay", "cannot stay", "not available", "available nahi", "mushkil hai", "mushkil hoga", "nahi ho payega", "nahi ho paayega", "nahi ho paega", "i can't", "i cannot", "can't do", "cannot do", "won't be able", "unable to", "decline", "reject", "mana", "not possible", "possible nahi", "nahi chahiye overtime", "नहीं कर पाऊंगा", "नहीं कर पाऊंगी", "नहीं रुक", "मुश्किल")],
  otClarify: w("kis din", "kaun sa din", "kaunsa din", "kab hai", "kar loon", "kar lu", "subah jaldi", "jaldi aa ke", "ki jagah", "instead", "ke bajaye", "ke badle", "sirf ek ghanta", "only one hour", "one hour only", "not two", "do nahi", "lekin", "but not", "par 8", "but only", "kitne ghante", "kitni der", "kitna time", "payment", "pay milega", "paise milenge", "paisa", "extra pay", "extra paisa", "compensation", "compensat", "comp off", "kab tak", "what time", "timing kya", "time change", "time badal", "baad mein aa sakta", "ke baad", "dinner", "cab milegi", "cab", "transport", "drop", "kaun sa din", "which day", "how many hours", "how long", "will i be paid", "paid", "kyun", "why", "कितने घंटे", "पैसे", "कब तक"),
  busy: w("busy", "bizi", "vyast", "meeting mein", "meeting me", "in a meeting", "drive kar raha", "drive kar rahi", "driving", "gaadi chala", "bike chala", "abhi nahi", "abhi baat nahi", "baat nahi kar sakta", "baat nahi kar sakti", "can't talk", "cannot talk", "not now", "not a good time", "bad time", "thodi der baad", "baad mein baat", "बाद में", "व्यस्त", "अभी नहीं", "मीटिंग में"),
  callback: w("baad mein", "baad me", "baat karte hain", "baat karenge", "baat kar lenge", "call back", "callback", "call me back", "call me later", "call me at", "call me in", "call me tomorrow", "baad mein call", "baad me call", "phir se call", "phir call", "dobara call", "call karna", "call kar lena", "call kar dena", "call karo", "baad mein baat karte", "later", "kal baat", "kal call", "shaam ko call", "remind me", "soch ke batata", "sochke batata", "soch ke bataungi", "sochke bataungi", "soch kar batata", "let me think", "baad mein batata", "baad mein bataungi", "फिर से कॉल", "बाद में कॉल", "कल बात"),
  stop: w("call mat karo", "call mat karna", "calls mat karo", "phone mat karo", "phone mat karna", "call band karo", "call band kar do", "calls band", "band karo ye call", "mujhe call mat", "mujhe phone mat", "ai call nahi chahiye", "call nahi chahiye", "calls nahi chahiye", "aage se call mat", "kabhi call mat", "don't call", "do not call", "dont call", "stop calling", "stop these calls", "stop the calls", "stop call", "no more calls", "unsubscribe", "never call", "don't contact", "कॉल मत", "फोन मत", "कॉल बंद"),
  humanRe: [/(hr|h\.r\.|एचआर|manager|मैनेजर)[^.?!]{0,20}(se|ko|with|to)\s+(baat|बात|connect|bulao|call|bhejo|bolo|escalate|speak|talk)/u, /(escalate|send|forward)[^.?!]{0,15}(to hr|hr ko|to my manager)/u, /(talk|speak)\s+(to|with)\s+(my\s+)?(reporting\s+)?(manager|hr|someone|a person|a human|human)/u, /(isse|ise|is baat ko)\s+hr\s+ko/u, /(hr|manager)\s+ko\s+(?:[^.?!]{0,20}\s)?(bol do|bata do|batao|bolo|kaho)/u, /(baat|talk|speak|connect)[^.?!]{0,20}(human|real person|actual person|insaan|person in hr)/u, /(human|real person|insaan|person)[^.?!]{0,12}(se baat|chahiye|please)/u],
  human: w("hr se baat", "hr se baat karni", "hr se baat karao", "hr se baat karwao", "hr ko bulao", "hr ko call", "hr ko bolo", "hr ko connect", "connect me to hr", "connect me with hr", "connect to hr", "talk to hr", "speak to hr", "speak with hr", "talk to a human", "talk to a person", "talk to someone", "speak to someone", "insaan se", "kisi insaan", "kisi se baat", "manager se baat", "manager ko bulao", "asli insaan", "hr chahiye", "human hr", "एचआर से बात", "इंसान से"),
  complaint: w("complain", "complaint", "shikayat", "grievance", "unfair", "injustice", "pareshan", "pareshaan", "torture", "workload", "bahut kaam", "zyada kaam", "too much work", "overworked", "manager problem", "manager se problem", "partiality", "favouritism", "bias", "conflict", "jhagda", "fight", "शिकायत", "परेशान"),
  harassRe: /(harass|harrass|molest|stalk|bully|bullie|abus|threaten|sexual|inappropriat|उत्पीड़|छेड़)/u,
  harassment: w("harass", "harassed", "harassment", "harrassment", "utpidan", "chhed", "chhedkhani", "chhedchhad", "misbehave", "misbehaved", "misbehaviour", "badtameezi", "badtamizi", "galat tarike se chhua", "touched me", "inappropriate", "sexual", "abuse", "abused", "abusive", "gaali", "gaaliyan", "threat", "threatened", "dhamki", "bully", "bullying", "उत्पीड़न", "छेड़छाड़", "बदतमीज़ी", "धमकी"),
  accident: w("accident", "hadsa", "haadsa", "gir gaya", "gir gayi", "gir gya", "chot", "chot lagi", "injured", "injury", "hurt", "fracture", "ambulance", "takkar", "dhakka laga", "bleeding", "khoon", "दुर्घटना", "चोट", "एक्सीडेंट"),
  emergency: w("emergency", "icu", "admit", "admitted", "bhartee", "bharti", "death", "died", "guzar gaye", "guzar gayi", "expired", "passed away", "maut", "fire", "aag", "aag lag", "chori", "theft", "stolen", "behosh", "unconscious", "heart attack", "gas leak", "lift mein phanse", "short circuit", "एमरजेंसी", "इमरजेंसी", "भर्ती", "गुज़र"),
  privacy: w("privacy", "my data", "data kaun", "kaun dekhega", "who will see", "who can see", "personal info", "meri jaankari", "meri details", "share karoge", "share karenge", "data store", "data safe", "गोपनीयता"),
  recording: w("record", "recording", "recorded", "record ho raha", "record kar rahe", "is this recorded", "रिकॉर्ड"),
  aiIdentity: w("aap kaun", "tum kaun", "kaun ho", "kaun bol", "who are you", "who is this", "robot", "bot", "ai ho", "machine ho", "real ho", "insaan ho", "are you human", "are you a human", "are you real", "are you a real person", "real person ho", "insaan ho ya", "are you ai", "are you a bot", "are you a robot", "kya aap ai", "kya tum ai", "computer ho", "कौन हो", "कौन बोल", "रोबोट"),
  policy: w("policy", "policies", "niyam", "rule", "rules", "kitni leave", "leave balance", "kitni chhutti", "kitni chutti", "holiday", "holidays", "chhutti kab", "late kitne", "grace", "grace period", "shift timing", "working hours", "office timing", "office time", "notice period", "wfh policy", "probation", "पॉलिसी", "नियम"),
  payroll: w("salary", "tankhwah", "tankha", "payslip", "pay slip", "salary slip", "pf", "tds", "deduction", "kata", "kat gaya", "kaat", "incentive", "reimburse", "reimbursement", "claim", "bonus", "increment", "loss of pay", "lop", "वेतन", "सैलरी"),
  confused: w("nahi samjha", "nahi samjhi", "nahi samajh", "samajh nahi", "samjha nahi", "samjhi nahi", "samajh nhi", "kya matlab", "matlab", "confuse", "confused", "confusing", "didn't understand", "did not understand", "don't understand", "not clear", "what do you mean", "kya bol rahe", "kya bol rahi", "kya keh rahe", "kya keh rahi", "समझ नहीं", "मतलब"),
  repeat: w("phir se bolo", "phir se boliye", "dobara bolo", "dobara boliye", "repeat", "repeat karo", "say again", "say that again", "dheere", "dheere boliye", "slowly", "speak slowly", "simple mein", "aasaan", "kya kaha", "pardon", "sunai nahi", "awaaz nahi", "aawaz nahi", "can't hear", "cannot hear", "फिर से", "सुनाई नहीं"),
  angry: w("bakwas", "bekaar", "bekar", "faltu", "irritate", "irritating", "irritated", "gussa", "pagal", "stupid", "nonsense", "ridiculous", "har baar", "baar baar", "roz roz", "why do you keep", "kyun pareshan", "disturb", "hadd hai", "had hai", "annoying", "annoyed", "fed up", "tang aa", "dimag kharab", "बकवास", "गुस्सा", "परेशान मत"),
  worried: w("tension", "pareshani", "dar", "darr", "worried", "worry", "chinta", "scared", "afraid", "anxious", "चिंता", "डर"),
  uncomfortable: w("comfortable nahi", "uncomfortable", "nahi batana", "nahi bata sakta", "nahi bata sakti", "personal hai", "private hai", "don't want to share", "rather not say", "won't say", "nahi bataunga", "nahi bataungi", "नहीं बताना"),
  greeting: w("hello", "helo", "hi", "hii", "hey", "namaste", "namaskar", "namaskaar", "good morning", "good afternoon", "good evening", "haan bolo", "ji bolo", "हेलो", "नमस्ते", "नमस्कार"),
  thanks: w("thank you", "thanks", "thank u", "thx", "shukriya", "dhanyavaad", "dhanyawad", "dhanywad", "धन्यवाद", "शुक्रिया"),
  goodbye: w("bye", "bye bye", "alvida", "rakhta hoon", "rakhti hoon", "phone rakh", "that's all", "thats all", "bas itna", "bas itna hi", "ok bye", "goodbye", "see you", "बाय", "अलविदा"),
  notScheduled: [w("week off", "weekly off", "weekoff", "off day", "mera off", "aaj off hai", "aaj mera off", "off hai mera", "off hai aaj", "rotational off", "today is my off", "i'm off today", "i am off today", "my day off", "holiday hai", "aaj holiday", "aaj to holiday", "public holiday", "state holiday", "company holiday", "tyohaar hai", "tyohar hai", "chhutti hai aaj", "aaj chhutti hai", "aaj to chhutti", "aaj ki chhutti hai", "aaj ki chhutti", "office band hai", "evening shift", "afternoon shift", "night shift", "second shift", "late shift", "shift late", "late wali", "shift abhi start nahi", "shift start nahi", "shift raat ki", "shift shaam ki", "shift to raat", "roster mein galti", "roster dekh lo", "shift rotate", "rotate hui", "off ke din", "off day pe", "chhutti ke din", "off wale din", "dono shift", "both shifts", "not the morning", "वीक ऑफ", "छुट्टी है", "हॉलिडे", "त्योहार"), /(meri|my)\s+shift[^.?!]{0,30}(se hai|se|starts|start|from|hai|is)\s*/u, /(diwali|holi|election|eid|christmas)[^.?!]{0,20}(chhutti|holiday|hai)/u],
  dispute: [/(galat|wrong|mistake|galti|incorrect|error)[^.?!]{0,30}(absent|attendance|late mark|half day|half-day|lop|loss of pay|mark)/u, /(absent|attendance|late mark|half day|half-day|lop|loss of pay)[^.?!]{0,30}(galat|wrong|mistake|galti|incorrect|by mistake|galti se)/u, w("kal ka absent", "pichhle hafte ki attendance", "purani attendance")],
  dontKnow: w("pata nahi", "nahi pata", "pta nahi", "malum nahi", "maloom nahi", "not sure", "don't know", "dont know", "no idea", "kuch pata nahi", "keh nahi sakta", "keh nahi sakti", "पता नहीं", "मालूम नहीं"),
  decline: w("baat nahi karni", "koi baat nahi karni", "baat nahi karna", "nahi chahiye baat", "baat nahi chahiye", "no thanks", "no thank you", "rather not", "i'd rather not", "not interested", "don't want to talk", "do not want to talk", "बात नहीं करनी"),
  whyCall: w("call kyun", "kyun call", "kyu call", "why are you calling", "why did you call", "why this call", "what is this about", "what's this about", "kis baare mein", "kis bare me", "kis cheez ka call", "kya baat hai", "kya hua", "kya problem hai", "notification aaya", "ye call kyun", "yeh call kyun", "mujhe kyun call", "कॉल क्यों", "किस बारे में"),
  unrelated: w("cricket", "match", "movie", "film", "joke", "gaana", "song", "recipe", "news", "politics", "election", "weather kaisa", "mausam kaisa", "khana kya", "lunch mein kya", "date pe", "girlfriend", "boyfriend", "share market", "stock", "bitcoin", "ipl"),
};
const R: Record<ReasonCategory, RegExp> = {
  traffic: w("traffic", "trafic", "jam", "jaam", "signal", "congestion", "road block", "roadblock", "diversion", "rasta band", "road band", "ट्रैफिक", "जाम"),
  public_transport: w("metro", "bus", "train", "local train", "local", "auto", "rickshaw", "riksha", "cab", "uber", "ola", "rapido", "taxi", "cab nahi mil", "auto nahi mil", "मेट्रो", "बस", "ट्रेन", "ऑटो"),
  vehicle: w("puncture", "punchar", "pancher", "tyre", "tire", "bike kharab", "bike band", "scooty", "scooter", "car kharab", "car band", "breakdown", "break down", "broke down", "petrol", "petrol khatam", "engine", "gaadi kharab", "gadi kharab", "gaadi band", "battery", "गाड़ी", "पंचर"),
  weather: w("rain", "raining", "baarish", "barish", "barsat", "baarish ho rahi", "flood", "paani bhar", "pani bhar", "waterlogging", "waterlogged", "fog", "kohra", "storm", "aandhi", "toofan", "बारिश", "कोहरा", "तूफान"),
  illness: w("bimar", "beemar", "bimaar", "fever", "bukhar", "bukhaar", "tabiyat", "tabiyat kharab", "tabyat", "tabeeyat", "sick", "unwell", "not well", "not feeling well", "ill", "cold", "cough", "khansi", "zukam", "headache", "sar dard", "sir dard", "pet dard", "stomach", "vomit", "ulti", "loose motion", "migraine", "covid", "dengue", "saans", "breathing", "bp", "blood pressure", "sugar badh", "sugar low", "chest pain", "seene mein dard", "बीमार", "बुखार", "तबीयत"),
  medical: w("hospital", "doctor", "dr", "clinic", "checkup", "check-up", "check up", "appointment", "test", "tests", "blood test", "x-ray", "xray", "scan", "dawai", "medicine", "dentist", "surgery", "operation", "physiotherapy", "physio", "vaccination", "vaccine", "teeka", "tika", "injection", "mri", "ct scan", "ultrasound", "x ray", "अस्पताल", "डॉक्टर"),
  family: w("family", "ghar mein", "ghar pe", "mummy", "mumma", "papa", "maa", "mother", "father", "dad", "mom", "wife", "husband", "beta", "beti", "bachcha", "bachche", "baby", "son", "daughter", "bhai", "behen", "sister", "brother", "dadi", "nani", "dada", "nana", "parivar", "shaadi", "wedding", "funeral", "relative", "rishtedar", "परिवार", "माँ", "पापा", "शादी", "बच्चा"),
  emergency: w("emergency", "accident", "hadsa", "एमरजेंसी", "इमरजेंसी", "दुर्घटना"),
  personal: w("personal", "niji", "personal kaam", "ghar ka kaam", "bank ka kaam", "bank jana", "bank", "court", "documents", "passport", "exam", "पर्सनल"),
  attendance_system: L.attIssue,
  work: w("client", "client visit", "visit", "field", "field work", "site", "site visit", "bahar kaam", "market", "sales visit", "demo", "customer ke paas", "meeting outside", "bahar meeting", "outside meeting", "meeting bahar", "distributor", "dealer", "supplier", "क्लाइंट"),
  other: /$^/,
};
/** A routine medical visit (the person can still come in), as opposed to being at hospital or unwell. */
export const ROUTINE_MEDICAL = w("appointment", "checkup", "check-up", "check up", "test", "tests", "blood test", "clinic", "dentist", "physiotherapy", "physio", "vaccination", "vaccine", "teeka", "tika", "scan", "mri", "x ray", "x-ray", "report dikhane", "line lambi", "eye checkup", "doctor ke paas hoon", "doctor ke paas ja");

const REASON_ORDER: ReasonCategory[] = ["emergency", "illness", "medical", "family", "vehicle", "weather", "traffic", "public_transport", "attendance_system", "work", "personal"];

/** Parse the callback time a person asks for: "shaam 5 baje", "kal", "1 ghante baad", "later". */
export function parseCallback(raw: string, nowMin: number): string | undefined {
  const t = normalise(raw);
  const tm = parseTime(raw, nowMin);
  const tomorrow = any(t, w("kal", "tomorrow", "kal subah", "next day", "कल"));
  if (tm) return tomorrow ? `tomorrow ${tm.at}` : tm.at;
  if (tomorrow) return "tomorrow";
  if (any(t, w("shaam", "sham", "evening", "शाम"))) return "evening";
  if (any(t, w("lunch ke baad", "after lunch", "dopahar", "afternoon"))) return "afternoon";
  if (any(t, w("baad mein", "baad me", "later", "thodi der", "बाद में"))) return "later";
  return undefined;
}

const dontKnowEarly = (t: string) => L.dontKnow.test(t);

/** Understand one utterance. `nowMin` is minutes since midnight India time (for "11 baje", "20 minute mein"). */
/** Words HR taught the assistant (AI HR Assistant → Scenarios): a phrase that means an intent and/or a reason. */
export type CustomWord = { phrase: string; intent?: Intent; reason?: ReasonCategory };
/** Intents HR may attach to a custom phrase (everything the conversation acts on; never "unknown"). */
export const TEACHABLE_INTENTS: Intent[] = ["coming", "absent", "leave_applied", "want_leave", "half_day", "wfh", "already_checked_in", "attendance_issue", "not_scheduled", "still_working", "forgot_checkout", "overtime_accept", "overtime_reject", "overtime_clarify", "busy", "callback", "stop_calls", "human", "harassment", "accident", "emergency", "complaint", "yes", "no"];
const escapeRe = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const customRe = new Map<string, RegExp>();
const matchesPhrase = (t: string, phrase: string) => {
  let re = customRe.get(phrase);
  if (!re) { re = w(escapeRe(normalise(phrase))); customRe.set(phrase, re); }
  return re.test(t);
};

export function understand(raw: string, nowMin = 600, hint: { reason?: string; custom?: CustomWord[] } = {}): Nlu {
  const text = String(raw ?? "").slice(0, 1000);
  const t = normalise(text);
  const lang = detectLang(text);
  const found = new Set<Intent>();
  const add = (i: Intent, ok: boolean) => { if (ok) found.add(i); };
  const has = (k: keyof typeof L) => { const v = L[k]; return Array.isArray(v) ? v.some((r) => r.test(t)) : v.test(t); };

  if (!t) return { lang, intents: ["unknown"], primary: "unknown", slots: {}, tones: [], confidence: 0, text };
  add("harassment", has("harassment") || has("harassRe"));
  add("accident", has("accident"));
  add("emergency", has("emergency"));
  // "call mat karo abhi, baad mein" is a callback, not a stop.
  const later = any(t, w("abhi", "abhi nahi", "baad mein", "baad me", "later", "now", "right now", "thodi der", "kal", "tomorrow", "बाद में", "अभी"));
  add("stop_calls", has("stop") && !(later && !any(t, w("kabhi", "never", "aage se", "ever", "again", "anymore", "any more", "band", "stop", "unsubscribe"))));
  add("human", has("human") || has("humanRe"));
  add("ai_identity", has("aiIdentity"));
  add("recording", has("recording"));
  add("privacy", has("privacy"));
  add("complaint", has("complaint"));
  add("attendance_dispute", has("dispute"));
  const asking = any(t, w("kaun sa", "kaunsa", "which", "kab", "kitne", "kitni", "when", "what"));
  add("not_scheduled", has("notScheduled") && !asking);
  if (has("notScheduled") && asking) found.add("policy_question");
  add("why_call", has("whyCall") && t.split(" ").length <= 6);
  add("attendance_issue", has("attIssue") || has("attIssueRe") || /(network|internet|net|wifi)\s+(chala gaya|chala gya|gaya tha|nahi tha|down|band tha)/u.test(t));
  const checkinWords = /(check ?-?in|checkin|punch in|punch kiya|attendance|अटेंडेंस|चेक इन)/u.test(t);
  const elsewhere = /\p{L}+ ke (office|ghar|yahan|paas)/u.test(t) && !/(apne|mere|hamare) office/u.test(t);
  add("already_checked_in", !elsewhere && (has("checkedIn") || has("checkedInRe") || (checkinWords && has("forgotGeneric") && /(office|desk|seat|andar|inside|ऑफिस)/u.test(t))) && !has("forgotOut"));
  if (found.has("attendance_issue") && found.has("already_checked_in") && !/(office|desk|seat|ऑफिस|andar)/u.test(t)) found.delete("already_checked_in");
  add("leave_applied", has("leaveApplied"));
  add("want_leave", has("wantLeave") && !found.has("leave_applied"));
  add("half_day", has("halfDay"));
  add("wfh", has("wfh"));
  const absent = has("absent") && !has("attIssue") && !has("repeat") && !has("checkedIn") && !dontKnowEarly(t);
  add("absent", absent);
  if (dontKnowEarly(t) && absent) found.add("dont_know");
  add("coming", has("coming") && !absent && !found.has("already_checked_in") && !has("repeat"));
  add("still_working", has("stillWorking") || has("stillWorkingRe"));
  add("forgot_checkout", (has("forgotOut") || (has("forgotGeneric") && !checkinWords && hint.reason === "missing_checkout")) && !found.has("still_working") && !found.has("already_checked_in"));
  add("left_early", has("leftEarly"));
  add("overtime_reject", has("otReject"));
  add("overtime_accept", has("otAccept") && !found.has("overtime_reject"));
  add("overtime_clarify", has("otClarify"));
  add("policy_question", has("policy"));
  add("payroll_question", has("payroll"));
  const decline = has("decline");
  const dontKnow = has("dontKnow");
  add("dont_know", dontKnow);
  add("busy", has("busy") && !decline);
  add("callback", has("callback") || (found.has("busy") && !!parseTime(text, nowMin)));
  add("confused", has("confused"));
  add("repeat", has("repeat"));
  // Plain yes / no only when the sentence is short or starts with it.
  const words = t.split(" ").filter(Boolean);
  const first2 = words.slice(0, 2).join(" ");
  const short = words.length <= 3;
  const yesHead = (short && L.yes.test(t)) || L.yes.test(words[0] ?? "") || /^(haan ji|ji haan|theek hai|thik hai|of course|जी हाँ|ठीक है)/u.test(first2);
  const noHead = !dontKnow && ((short && L.no.test(t)) || /^(nahi|nahin|nhi|nai|naa|na|no|nope|nah|नहीं|नही|ना)$/u.test(words[0] ?? ""));
  const meta = found.has("confused") || found.has("repeat") || found.has("ai_identity") || found.has("why_call") || found.has("privacy") || found.has("recording");
  add("no", (noHead && !yesHead && !meta) || decline);
  add("yes", yesHead && !found.has("no") && !/^(nahi|no)/.test(t));
  add("greeting", L.greeting.test(t.split(" ").slice(0, 2).join(" ")));
  add("thanks", has("thanks"));
  add("goodbye", has("goodbye"));
  // HR's own vocabulary: adds what a phrase means (it never removes what the built-in rules found).
  const customHits = (hint.custom ?? []).filter((c) => c.phrase && matchesPhrase(t, c.phrase));
  for (const c of customHits) if (c.intent) found.add(c.intent);
  if (customHits.some((c) => c.intent === "absent")) found.delete("coming");
  add("unrelated", has("unrelated") && found.size === 0);

  // Reason
  let reason: ReasonCategory | undefined;
  for (const r of REASON_ORDER) if (R[r].test(t)) { reason = r; break; }
  if (reason === "illness" && R.family.test(t)) reason = "family"; // a family member is unwell: a family matter
  const customReason = customHits.find((c) => c.reason)?.reason;
  if (customReason && !reason) reason = customReason;
  if (found.has("accident")) reason = "emergency";
  const slots: Slots = {};
  if (reason) slots.reason = reason;
  const time = parseTime(text, nowMin);
  if (!time && (found.has("coming") || found.has("still_working")) && /[,\s](\d{1,2})\s*$/.test(t)) {
    const n = Number(t.match(/(\d{1,2})\s*$/)![1]);
    if (n >= 1 && n <= 12) { const tm = parseTime(`${n} baje`, nowMin); if (tm) slots.eta = tm.at; }
  }
  const asksLater = found.has("callback") && !found.has("coming") && !found.has("still_working");
  if (time && !asksLater) {
    if (found.has("forgot_checkout") || found.has("left_early") || (hint.reason === "missing_checkout" && /(nikla|nikli|nikal gaya|nikal gayi|left at|left around|chala gaya|chali gayi|niklaa)/u.test(t))) slots.leftAt = time.at;
    else slots.eta = time.at;
  }
  if (found.has("busy") || found.has("callback")) { const cb = parseCallback(text, nowMin); if (cb) slots.callback = cb; }

  const tones: Tone[] = [];
  if (has("angry") || /!{2,}/.test(text)) tones.push("angry");
  if (found.has("busy")) tones.push("busy");
  if (found.has("confused") || found.has("repeat")) tones.push("confused");
  if (has("worried") || found.has("emergency")) tones.push("worried");
  if (found.has("emergency") || found.has("accident") || found.has("harassment")) tones.push("urgent");
  if (has("uncomfortable")) tones.push("uncomfortable");
  if (!tones.length) tones.push("calm");

  const intents = INTENTS.filter((i) => found.has(i));
  if (!intents.length) intents.push("unknown");
  const primary = intents[0];
  const strong = intents.filter((i) => !["yes", "no", "greeting", "thanks", "unknown"].includes(i)).length;
  const confidence = primary === "unknown" ? (slots.reason || slots.eta ? 0.5 : 0.2) : Math.min(0.97, 0.6 + 0.12 * strong + (slots.eta ? 0.1 : 0) + (slots.reason ? 0.05 : 0));
  return { lang, intents, primary, slots, tones, confidence: Math.round(confidence * 100) / 100, text };
}
