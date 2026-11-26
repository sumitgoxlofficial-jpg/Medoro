// Sales Training Academy: rules shared by the server and the screens (no server imports here).

export const PROGRAMME_SLUG = "medoro-sales-academy";

/** The assessment areas and the marks each carries out of 100 (the programme's published weighting). */
export const AREAS = [
  { id: "product", label: "Product Knowledge", marks: 20, from: "Product knowledge quiz (26 questions, one per tour chapter)" },
  { id: "communication", label: "Sales Communication", marks: 15, from: "Final exam: communication, discovery, closing and compliance questions" },
  { id: "cold_calling", label: "Cold Calling", marks: 20, from: "Mock sales call: opening, hook, discovery and next step" },
  { id: "demo", label: "Product Demonstration", marks: 20, from: "Product demonstration assessment" },
  { id: "objection", label: "Objection Handling", marks: 10, from: "Mock sales call: objection handling" },
  { id: "crm", label: "CRM and Reporting", marks: 5, from: "Final exam: CRM and reporting questions" },
  { id: "professionalism", label: "Professionalism", marks: 10, from: "Mock sales call: tone, honesty and conduct" },
] as const;
export type AreaId = (typeof AREAS)[number]["id"];
export const AREA_IDS = AREAS.map((a) => a.id) as [AreaId, ...AreaId[]];
export const areaLabel = (id: string) => AREAS.find((a) => a.id === id)?.label ?? id;

/** What the trainer scores on each practical, with the area every criterion feeds. */
export const RUBRICS = {
  mock_call: [
    { id: "opening", label: "Opening and introduction", max: 5, area: "cold_calling" },
    { id: "hook", label: "Interest in the first 20 seconds (hook)", max: 5, area: "cold_calling" },
    { id: "discovery", label: "Discovery questions before pitching", max: 5, area: "cold_calling" },
    { id: "closing", label: "Clear next step (demo / follow-up booked)", max: 5, area: "cold_calling" },
    { id: "objection", label: "Objection handling without arguing or misleading", max: 10, area: "objection" },
    { id: "professionalism", label: "Professionalism: tone, listening, honest claims", max: 10, area: "professionalism" },
  ],
  demo: [
    { id: "preparation", label: "Demo prepared (demo account, demo data explained)", max: 4, area: "demo" },
    { id: "flow", label: "Logical flow: dashboard → stock → purchase → billing → reports", max: 4, area: "demo" },
    { id: "relevance", label: "Features chosen for this customer's needs", max: 4, area: "demo" },
    { id: "benefits", label: "Benefits explained accurately, no false promises", max: 4, area: "demo" },
    { id: "next_step", label: "Ends with a clear next step", max: 4, area: "demo" },
  ],
} as const satisfies Record<string, readonly { id: string; label: string; max: number; area: AreaId }[]>;
export type PracticalKind = keyof typeof RUBRICS;
export const PRACTICAL_KINDS = ["mock_call", "demo"] as const;
export const practicalLabel = (k: string) => (k === "mock_call" ? "Mock sales call" : k === "demo" ? "Product demonstration" : k);
export const rubricMax = (k: PracticalKind) => RUBRICS[k].reduce((a, c) => a + c.max, 0);

/** Policy HR and the super admin can change (HrSetting "training"). */
export type TrainingSettings = {
  passPct: number; // final score needed for the certificate (out of 100)
  productQuizPct: number; // product knowledge quiz pass mark
  lessonQuizPct: number; // each lesson's short quiz
  practicalPassPct: number; // each practical (share of its rubric)
  maxAttempts: number; // attempts allowed on the product quiz and the final exam (HR can grant more per person)
  maxPracticalAttempts: number;
  hrApproval: boolean; // HR must approve after the trainer before a certificate is issued
  attendanceRequired: boolean; // the trainer or HR must mark the person present
  minSlideSeconds: number; // least time on a slide before it counts as studied
  pricingNote: string; // HR-approved prices and offers sales staff may quote; empty = point customers to the pricing page
  signatory: string; // name printed under the authorised signature
};
export const DEFAULT_TRAINING_SETTINGS: TrainingSettings = {
  passPct: 80, productQuizPct: 80, lessonQuizPct: 70, practicalPassPct: 70, maxAttempts: 3, maxPracticalAttempts: 3,
  hrApproval: true, attendanceRequired: true, minSlideSeconds: 12, pricingNote: "", signatory: "",
};

export type Slide = { title: string; bullets: string[]; narration: string };
export type QA = { q: string; a: string };
export type LessonContent = {
  objectives?: string[];
  keyPoints?: string[];
  examples?: string[];
  qa?: QA[];
  /** Product-tour chapters. */
  chapter?: { part: number; startsAt: number; seconds: number; functions: string[]; problem: string; benefits: string[]; explain: string };
  /** Feature-to-benefit table. */
  features?: { feature: string; does: string; problem: string; benefit: string; pitch: string; question: string; answer: string }[];
  /** Objection library. */
  objections?: { statement: string; meaning: string; avoid: string; response: string; followUp: string; next: string }[];
  /** Opening scripts. */
  scripts?: { name: string; when: string; lines: string[] }[];
  takeaways?: string[];
};
export type Resource = { name: string; kind: "pdf" | "pptx" | "link"; key?: string; url?: string };

/** Slide dwell needed: longer narration needs longer, within sensible bounds. */
export function slideNeed(s: Slide, minSec: number) {
  const words = (s.narration + " " + s.bullets.join(" ")).split(/\s+/).filter(Boolean).length;
  return Math.max(minSec, Math.min(60, Math.round(words / 4)));
}

export const SEG = 5; // seconds per segment of video evidence
export const segCount = (seconds: number) => Math.max(1, Math.ceil(seconds / SEG));

export const STATUS_LABEL: Record<string, string> = {
  not_started: "Not started", learning: "Learning", practicals: "Practicals pending", review: "Awaiting trainer review",
  trainer: "Awaiting trainer approval", hr: "Awaiting HR approval", certified: "Certified", failed: "Below pass mark", rejected: "Not approved",
};

/** "10:15" → "10:15 AM" */
export const clock12 = (hhmm: string) => { const h = Number(hhmm.slice(0, 2)); return `${h % 12 || 12}:${hhmm.slice(3, 5)} ${h < 12 ? "AM" : "PM"}`; };
