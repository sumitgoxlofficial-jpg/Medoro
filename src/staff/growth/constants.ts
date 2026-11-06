// Growth Intelligence: shared by server services and console UI (no server imports here).

export type GrowthRoleId = "admin" | "manager" | "sales" | "analyst";
export const GROWTH_ROLE_LABEL: Record<GrowthRoleId, string> = { admin: "Super admin", manager: "Marketing manager", sales: "Sales employee", analyst: "Analyst" };

export const PERMS = [
  "leads.view", "leads.create", "leads.edit", "leads.import", "leads.export", "leads.verify", "leads.discover", "leads.merge",
  "assign", "team.manage", "targets.set", "calls.make", "performance.view", "analytics.view",
  "campaigns.manage", "campaigns.approve", "messages.send", "inbox.view", "consent.record",
  "compliance.view", "compliance.manage", "integrations.manage", "settings.manage", "ai.use", "jobs.run",
] as const;
export type Perm = (typeof PERMS)[number];

/** GrowthPermission: what each Growth role may do. Checked on the server for every action. */
export const ROLE_PERMS: Record<GrowthRoleId, readonly Perm[]> = {
  admin: PERMS,
  manager: ["leads.view", "leads.create", "leads.edit", "leads.import", "leads.export", "leads.verify", "leads.discover", "leads.merge", "assign", "targets.set", "calls.make", "performance.view", "analytics.view", "campaigns.manage", "messages.send", "inbox.view", "consent.record", "compliance.view", "ai.use"],
  sales: ["leads.view", "leads.edit", "calls.make", "messages.send", "inbox.view", "consent.record", "ai.use"],
  analyst: ["performance.view", "analytics.view"],
};

export type GrowthView =
  | "overview" | "discovery" | "leads" | "verification" | "ai" | "import" | "distribution" | "employees" | "performance"
  | "my-work" | "call" | "calls" | "follow-ups" | "pipeline" | "campaigns" | "whatsapp" | "email" | "inbox"
  | "analytics" | "compliance" | "integrations" | "settings";

/** The Growth Intelligence menu, in order, with the permission each needs. */
export const GROWTH_NAV: [GrowthView, string, Perm][] = [
  ["overview", "Overview dashboard", "analytics.view"],
  ["discovery", "Lead discovery", "leads.discover"],
  ["leads", "All pharmacy leads", "leads.view"],
  ["verification", "Lead verification", "leads.verify"],
  ["ai", "AI lead intelligence", "ai.use"],
  ["import", "Import centre", "leads.import"],
  ["distribution", "Lead distribution", "assign"],
  ["employees", "My employees", "targets.set"],
  ["performance", "Employee performance", "performance.view"],
  ["my-work", "My assigned leads", "calls.make"],
  ["call", "Calling workspace", "calls.make"],
  ["calls", "Call history", "calls.make"],
  ["follow-ups", "Follow-up calendar", "calls.make"],
  ["pipeline", "Sales pipeline", "leads.view"],
  ["campaigns", "Campaign manager", "campaigns.manage"],
  ["whatsapp", "WhatsApp manager", "campaigns.manage"],
  ["email", "Email manager", "campaigns.manage"],
  ["inbox", "Unified inbox", "inbox.view"],
  ["analytics", "Analytics", "analytics.view"],
  ["compliance", "Compliance centre", "compliance.view"],
  ["integrations", "Integrations", "integrations.manage"],
  ["settings", "Settings", "settings.manage"],
];

export const STAGES = [
  ["NEW_LEAD", "New lead"], ["RESEARCH_PENDING", "Research pending"], ["QUALIFIED", "Qualified"], ["ASSIGNED", "Assigned"],
  ["CONTACT_PERMISSION_PENDING", "Contact permission pending"], ["CONTACT_AUTHORIZED", "Contact authorised"], ["FIRST_CONTACT", "First contact"],
  ["INTERESTED", "Interested"], ["DEMO_SCHEDULED", "Demo scheduled"], ["DEMO_COMPLETED", "Demo completed"], ["TRIAL_STARTED", "Trial started"],
  ["NEGOTIATION", "Negotiation"], ["CONVERTED", "Converted"], ["LOST", "Lost"], ["FOLLOW_UP_LATER", "Follow-up later"], ["DO_NOT_CONTACT", "Do not contact"],
] as const;
export type Stage = (typeof STAGES)[number][0];
export const STAGE_IDS = STAGES.map((s) => s[0]) as [Stage, ...Stage[]];
export const stageLabel = (s: string) => STAGES.find((x) => x[0] === s)?.[1] ?? s;
export const CLOSED_STAGES: Stage[] = ["CONVERTED", "LOST", "DO_NOT_CONTACT"];

export const OUTCOMES = [
  ["NOT_CALLED", "Not called"], ["NO_ANSWER", "No answer"], ["BUSY", "Busy"], ["CONNECTED", "Connected"], ["INTERESTED", "Interested"],
  ["NOT_INTERESTED", "Not interested"], ["WRONG_NUMBER", "Wrong number"], ["FOLLOW_UP_REQUIRED", "Follow-up required"],
  ["DEMO_SCHEDULED", "Demo scheduled"], ["CONVERTED", "Converted"], ["DO_NOT_CONTACT", "Do not contact"],
] as const;
export type Outcome = (typeof OUTCOMES)[number][0];
export const OUTCOME_IDS = OUTCOMES.map((o) => o[0]) as [Outcome, ...Outcome[]];
export const outcomeLabel = (s: string) => OUTCOMES.find((x) => x[0] === s)?.[1] ?? s;
/** Outcomes where someone answered. NOT_CALLED, NO_ANSWER, BUSY and WRONG_NUMBER are attempts without a conversation with the pharmacy. */
export const CONNECTED_OUTCOMES: Outcome[] = ["CONNECTED", "INTERESTED", "NOT_INTERESTED", "FOLLOW_UP_REQUIRED", "DEMO_SCHEDULED", "CONVERTED", "DO_NOT_CONTACT"];
export const INTERESTED_OUTCOMES: Outcome[] = ["INTERESTED", "DEMO_SCHEDULED", "CONVERTED"];
/** A report with this outcome counts as a call attempt. NOT_CALLED is recorded but is not an attempt. */
export const isAttempt = (o: string) => o !== "NOT_CALLED";
export const INTEREST_LEVELS = ["none", "low", "medium", "high"] as const;
export const SOFTWARE_STATUS = [["", "Not asked"], ["none", "No billing software"], ["paper", "Paper / manual billing"], ["other_unhappy", "Other software, unhappy"], ["other_happy", "Other software, satisfied"]] as const;

export const VERIFICATION_LABEL: Record<string, string> = {
  UNVERIFIED: "Unverified", BUSINESS_VERIFIED: "Business verified", PHONE_VERIFIED: "Phone verified", EMAIL_VERIFIED: "Email verified",
  WEBSITE_VERIFIED: "Website verified", PARTIALLY_VERIFIED: "Partially verified", INVALID: "Invalid", DUPLICATE: "Duplicate",
};
export const CATEGORIES = [["RETAIL", "Retail medical store"], ["INDEPENDENT", "Independent pharmacy"], ["CHAIN", "Pharmacy chain"], ["HOSPITAL", "Hospital pharmacy"], ["MEDICINE_RETAILER", "Medicine retailer"], ["OTHER", "Other"]] as const;
export type Category = (typeof CATEGORIES)[number][0];
export const CATEGORY_IDS = CATEGORIES.map((c) => c[0]) as [Category, ...Category[]];
export const categoryLabel = (s: string) => CATEGORIES.find((x) => x[0] === s)?.[1] ?? s;

export const LOST_REASONS = ["Price", "Using other software", "Not ready yet", "No response", "Closed the shop", "Not a pharmacy", "Other"] as const;
export const CHANNELS = ["phone", "whatsapp", "email", "sms"] as const;
export const SUPPRESSION_CHANNELS = ["all", "phone", "whatsapp", "email"] as const;
export const LAWFUL_BASES = [["consent", "Consent (DPDP s.6)"], ["legitimate_use", "Legitimate use (DPDP s.7), e.g. information the person gave voluntarily"]] as const;

export const INDIAN_STATES = [
  "Andhra Pradesh", "Arunachal Pradesh", "Assam", "Bihar", "Chhattisgarh", "Goa", "Gujarat", "Haryana", "Himachal Pradesh", "Jharkhand", "Karnataka",
  "Kerala", "Madhya Pradesh", "Maharashtra", "Manipur", "Meghalaya", "Mizoram", "Nagaland", "Odisha", "Punjab", "Rajasthan", "Sikkim", "Tamil Nadu",
  "Telangana", "Tripura", "Uttar Pradesh", "Uttarakhand", "West Bengal",
  "Andaman and Nicobar Islands", "Chandigarh", "Dadra and Nagar Haveli and Daman and Diu", "Delhi", "Jammu and Kashmir", "Ladakh", "Lakshadweep", "Puducherry",
] as const;

/** Matches a typed state name ("maharashtra", "MH", "Orissa") to the canonical name, or "". */
const STATE_ALIAS: Record<string, string> = {
  ap: "Andhra Pradesh", ar: "Arunachal Pradesh", as: "Assam", br: "Bihar", cg: "Chhattisgarh", ct: "Chhattisgarh", ga: "Goa", gj: "Gujarat", hr: "Haryana", hp: "Himachal Pradesh",
  jh: "Jharkhand", ka: "Karnataka", kl: "Kerala", mp: "Madhya Pradesh", mh: "Maharashtra", mn: "Manipur", ml: "Meghalaya", mz: "Mizoram", nl: "Nagaland", od: "Odisha", or: "Odisha",
  orissa: "Odisha", pb: "Punjab", rj: "Rajasthan", sk: "Sikkim", tn: "Tamil Nadu", ts: "Telangana", tg: "Telangana", tr: "Tripura", up: "Uttar Pradesh", uk: "Uttarakhand",
  ut: "Uttarakhand", uttaranchal: "Uttarakhand", wb: "West Bengal", an: "Andaman and Nicobar Islands", ch: "Chandigarh", dl: "Delhi", newdelhi: "Delhi", nctofdelhi: "Delhi",
  jk: "Jammu and Kashmir", la: "Ladakh", ld: "Lakshadweep", py: "Puducherry", pondicherry: "Puducherry", dnhdd: "Dadra and Nagar Haveli and Daman and Diu",
};
export function canonicalState(raw: string): string {
  const k = String(raw ?? "").toLowerCase().replace(/[^a-z]/g, "");
  if (!k) return "";
  const hit = INDIAN_STATES.find((s) => s.toLowerCase().replace(/[^a-z]/g, "") === k);
  return hit ?? STATE_ALIAS[k] ?? "";
}

export const PIN_RE = /^[1-9]\d{5}$/;
export const rupees = (paise: number) => "₹" + Math.round(paise / 100).toLocaleString("en-IN");
