// Lead scoring (max 100) from recorded evidence only. Pure: the caller loads the facts.

export type Provenance = "verified" | "user_provided" | "source" | "unknown";
export type ScoreLine = { key: string; label: string; max: number; points: number; provenance: Provenance; evidence: string };
export type ScoreFacts = {
  businessVerifiedAt: Date | null; phoneVerifiedAt: Date | null; emailVerifiedAt: Date | null; websiteVerifiedAt: Date | null; locationVerifiedAt: Date | null;
  phone: string | null; email: string; website: string; address: string; pin: string; state: string; district: string; city: string; lat: number | null;
  softwareStatus: string;
  /** The best call outcome reported for this lead, and whether a demo or conversion is on record. */
  bestOutcome: string | null; demo: boolean; converted: boolean;
};

const day = (d: Date) => d.toISOString().slice(0, 10);

export function computeScore(f: ScoreFacts): { total: number; lines: ScoreLine[] } {
  const lines: ScoreLine[] = [];

  lines.push(f.businessVerifiedAt
    ? { key: "business", label: "Verified business identity", max: 20, points: 20, provenance: "verified", evidence: `Business verified on ${day(f.businessVerifiedAt)}` }
    : { key: "business", label: "Verified business identity", max: 20, points: 0, provenance: "unknown", evidence: "Not verified yet (licence, GST or field check)" });

  if (f.phoneVerifiedAt) lines.push({ key: "contact", label: "Verified public contact", max: 20, points: 20, provenance: "verified", evidence: `Phone confirmed on a call, ${day(f.phoneVerifiedAt)}` });
  else if (f.emailVerifiedAt) lines.push({ key: "contact", label: "Verified public contact", max: 20, points: 15, provenance: "verified", evidence: `Email verified ${day(f.emailVerifiedAt)}; phone not yet confirmed` });
  else lines.push({ key: "contact", label: "Verified public contact", max: 20, points: 0, provenance: f.phone || f.email ? "source" : "unknown", evidence: f.phone || f.email ? "Contact listed by the source, not verified" : "No contact on record" });

  if (f.websiteVerifiedAt) lines.push({ key: "digital", label: "Digital presence", max: 15, points: 15, provenance: "verified", evidence: `Website checked ${day(f.websiteVerifiedAt)}` });
  else if (f.website) lines.push({ key: "digital", label: "Digital presence", max: 15, points: 5, provenance: "source", evidence: "Website listed, not checked" });
  else lines.push({ key: "digital", label: "Digital presence", max: 15, points: 0, provenance: "unknown", evidence: "No website on record" });

  const complete = !!(f.address && /^[1-9]\d{5}$/.test(f.pin) && f.state && f.city);
  if (f.locationVerifiedAt) lines.push({ key: "location", label: "Verified location", max: 15, points: 15, provenance: "verified", evidence: `Location confirmed ${day(f.locationVerifiedAt)}` });
  else if (complete) lines.push({ key: "location", label: "Verified location", max: 15, points: f.lat !== null ? 8 : 6, provenance: "source", evidence: `Full address with PIN from the source${f.lat !== null ? ", with map coordinates" : ""}; not confirmed` });
  else lines.push({ key: "location", label: "Verified location", max: 15, points: 0, provenance: "unknown", evidence: "Address incomplete" });

  const sw: Record<string, [number, string]> = { none: [15, "Owner said they use no billing software"], paper: [15, "Owner said they bill on paper"], other_unhappy: [10, "Uses other software and is unhappy with it"], other_happy: [3, "Uses other software and is satisfied"] };
  const s = sw[f.softwareStatus];
  lines.push(s ? { key: "software", label: "Potential software requirement", max: 15, points: s[0], provenance: "user_provided", evidence: s[1] + " (call report)" } : { key: "software", label: "Potential software requirement", max: 15, points: 0, provenance: "unknown", evidence: "Not asked yet" });

  let eng: [number, string] = [0, "No conversation yet"];
  if (f.converted) eng = [15, "Converted"];
  else if (f.demo || f.bestOutcome === "DEMO_SCHEDULED") eng = [15, "Demo scheduled"];
  else if (f.bestOutcome === "INTERESTED") eng = [12, "Said they are interested"];
  else if (f.bestOutcome === "FOLLOW_UP_REQUIRED") eng = [8, "Asked for a follow-up"];
  else if (f.bestOutcome === "CONNECTED") eng = [5, "Spoke to the pharmacy"];
  else if (f.bestOutcome === "NOT_INTERESTED" || f.bestOutcome === "DO_NOT_CONTACT") eng = [0, "Not interested"];
  lines.push({ key: "engagement", label: "Positive engagement", max: 15, points: eng[0], provenance: eng[0] || f.bestOutcome ? "user_provided" : "unknown", evidence: eng[1] + (f.bestOutcome ? " (employee call report)" : "") });

  return { total: lines.reduce((n, l) => n + l.points, 0), lines };
}

/** Summary verification status from the per-dimension verifications. */
export function deriveVerification(l: { invalidReason: string | null; duplicateOfId: string | null; businessVerifiedAt: Date | null; phoneVerifiedAt: Date | null; emailVerifiedAt: Date | null; websiteVerifiedAt: Date | null }) {
  if (l.duplicateOfId) return "DUPLICATE" as const;
  if (l.invalidReason) return "INVALID" as const;
  const dims: [Date | null, "BUSINESS_VERIFIED" | "PHONE_VERIFIED" | "EMAIL_VERIFIED" | "WEBSITE_VERIFIED"][] = [[l.businessVerifiedAt, "BUSINESS_VERIFIED"], [l.phoneVerifiedAt, "PHONE_VERIFIED"], [l.emailVerifiedAt, "EMAIL_VERIFIED"], [l.websiteVerifiedAt, "WEBSITE_VERIFIED"]];
  const done = dims.filter(([d]) => d);
  if (!done.length) return "UNVERIFIED" as const;
  if (done.length === 1) return done[0][1];
  return "PARTIALLY_VERIFIED" as const;
}
