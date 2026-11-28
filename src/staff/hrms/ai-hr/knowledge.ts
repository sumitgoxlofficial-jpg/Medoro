import type { Lang } from "./nlu";
import { normalise } from "./nlu";
import { FAQ, type SeedDoc } from "./knowledge-faq";
import SEED from "./knowledge-seed.json";

// Retrieval for the AI HR Assistant: BM25 over approved knowledge records, with Hinglish/Hindi terms mapped to the
// English words the records use. Pure and synchronous, so it runs inside the conversation engine and the evaluation.
// Below the score threshold it returns nothing and the assistant says HR needs to confirm, instead of guessing.
// The library is small (hundreds of records), so an in-memory index is faster and simpler than a vector store;
// pgvector embeddings can be added later behind the same interface (see docs/ai-hr-assistant/ARCHITECTURE.md).

export type KDoc = { key: string; title: string; body: string; source: string; scope: "product" | "organisation"; version?: number };
export type Hit = { doc: KDoc; score: number; passage: string; coverage: number; matched: number };

const SYN: Record<string, string> = {
  chhutti: "leave", chutti: "leave", chhuttiyan: "leave", chhuttiya: "leave", छुट्टी: "leave", लीव: "leave", avkash: "leave",
  tankhwah: "salary", tankha: "salary", वेतन: "salary", सैलरी: "salary", paisa: "pay", paise: "pay",
  hajiri: "attendance", haziri: "attendance", हाज़िरी: "attendance", अटेंडेंस: "attendance",
  niyam: "policy", नियम: "policy", पॉलिसी: "policy", kanoon: "policy",
  istifa: "resignation", इस्तीफ़ा: "resignation", resign: "resignation", resigning: "resignation",
  dastavez: "documents", दस्तावेज़: "documents", document: "documents", kagaz: "documents",
  badalna: "change", badalni: "change", badal: "change", update: "change",
  cancel: "cancel", radd: "cancel", wapas: "withdraw",
  pf: "pf", tds: "tds", esi: "esi", lop: "loss pay",
  slip: "payslip", payslips: "payslip", "pay-slip": "payslip",
  login: "sign-in", "log-in": "sign-in", password: "password", otp: "one-time password",
  holiday: "holidays", holidays: "holidays", tyohar: "holidays", tyohaar: "holidays",
  claim: "claims", reimburse: "reimbursement", reimbursement: "reimbursement", bill: "claims",
  shift: "shift", roster: "roster", swap: "swaps", exchange: "swaps",
  appraisal: "review", rating: "review", increment: "review",
  bank: "bank", account: "account", ifsc: "ifsc",
  joining: "joining", join: "joining", onboarding: "onboarding",
  gratuity: "gratuity", settlement: "settlement", encashment: "settlement",
  notice: "notice", training: "courses", course: "courses", quiz: "quiz",
  wfh: "work home", remote: "work home",
  overtime: "overtime", incentive: "incentive", commission: "incentive", target: "target",
  correction: "correction", galat: "wrong", wrong: "wrong",
};
// Question words and filler verbs carry no topic: they never count towards a match.
const STOP = new Set(("the a an is are am i my me to of in on for and or do does did can could will would be it this that what how when where which who why get got need want there " +
  "mera meri mere mujhe hai hain ho ka ki ke ko se mein me kya aur bhi tha thi please kar karna karni karun karte karta hota hoti hote sakta sakti sakte " +
  "kab kaise kahan kahaan kitna kitni kitne kyun kyon kaun milega milegi milta milti milte milenge chahiye lena dena hoga hogi raha rahi rahe abhi tak wala wali hi").split(" "));
const stem = (w: string) => w.replace(/(ing|ed|es|s)$/u, "");
export function terms(text: string): string[] {
  const out: string[] = [];
  for (const raw of normalise(text).split(/[\s:.'?!-]+/)) {
    if (!raw || STOP.has(raw)) continue;
    const m = SYN[raw];
    for (const t of (m ?? raw).split(" ")) if (t && !STOP.has(t)) out.push(stem(t));
  }
  return out;
}

export class Index {
  private docs: { d: KDoc; tf: Map<string, number>; len: number }[] = [];
  private df = new Map<string, number>();
  private avg = 1;
  constructor(docs: KDoc[]) {
    for (const d of docs) {
      const tf = new Map<string, number>();
      const ts = terms(`${d.title} ${d.title} ${d.body}`);
      for (const t of ts) tf.set(t, (tf.get(t) ?? 0) + 1);
      this.docs.push({ d, tf, len: ts.length });
      for (const t of tf.keys()) this.df.set(t, (this.df.get(t) ?? 0) + 1);
    }
    this.avg = this.docs.reduce((a, x) => a + x.len, 0) / Math.max(1, this.docs.length);
  }
  get size() { return this.docs.length; }
  search(q: string, take = 3): Hit[] {
    const qt = [...new Set(terms(q))];
    if (!qt.length) return [];
    const N = this.docs.length, k1 = 1.4, b = 0.75;
    const scored = this.docs.map((x) => {
      let s = 0, matched = 0;
      for (const t of qt) {
        const f = x.tf.get(t); if (!f) continue;
        matched++;
        const idf = Math.log(1 + (N - (this.df.get(t) ?? 0) + 0.5) / ((this.df.get(t) ?? 0) + 0.5));
        s += idf * (f * (k1 + 1)) / (f + k1 * (1 - b + b * x.len / this.avg));
      }
      return { doc: x.d, score: s, passage: firstSentences(x.d.body, 2), coverage: matched / qt.length, matched };
    }).filter((h) => h.score > 0).sort((a, z) => z.score - a.score);
    return scored.slice(0, take);
  }
}
export const firstSentences = (s: string, n: number) => (s.match(/[^.!?]+[.!?]+/g) ?? [s]).slice(0, n).join(" ").trim();

/** Minimum BM25 score for an answer in a full index; below it the assistant routes the question to HR. */
export const THRESHOLD = 3.2;
/** Share of the question's topic words a record must contain to answer it. */
export const MIN_COVERAGE = 0.5;
/** A record answers only with enough of the question's topic words, and, in a large index, a clear score. */
export const confident = (h: Hit | undefined, indexSize: number): h is Hit =>
  !!h && h.coverage >= MIN_COVERAGE && h.matched >= 1 && (indexSize < 20 || h.score >= THRESHOLD);

/** The built-in product knowledge (version-controlled seed). Organisation knowledge is added at runtime. */
export function productDocs(): KDoc[] {
  const seed = (SEED as SeedDoc[]).map((d) => ({ key: d.key, title: d.title, body: d.body, source: d.source, scope: "product" as const }));
  return [...FAQ.map((d) => ({ key: d.key, title: d.title, body: d.body, source: d.source, scope: "product" as const })), ...seed];
}
let cached: Index | null = null;
export const productIndex = () => (cached ??= new Index(productDocs()));

/** A knowledge function for the engine: answers only above the threshold, naming the record it came from. */
export function kbFrom(index: Index) {
  return (q: string, _lang: Lang): { answer: string; source: string } | null => {
    const top = index.search(q, 1)[0];
    if (!confident(top, index.size)) return null;
    return { answer: top.passage, source: top.doc.title };
  };
}
