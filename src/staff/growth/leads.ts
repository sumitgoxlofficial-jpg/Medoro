import "server-only";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { db, type Tx } from "@/server/db";
import { UserError } from "@/server/action";
import { nextSeq } from "@/server/sequence";
import { hit } from "@/server/ratelimit";
import { toCsv } from "@/lib/csv-format";
import { activity, findLead, gaudit, leadScope, need, type Actor } from "./access";
import { CATEGORY_IDS, PIN_RE, STAGE_IDS, canonicalState, type Category } from "./constants";
import { addressKey, clean, domainOf, nameKey, normEmail, normWebsite, similarity, toE164 } from "./normalize";
import { computeScore, deriveVerification, type ScoreFacts } from "./score";
import { suppressionFor } from "./compliance";

type Db = Tx | typeof db;
const SEQ = "_growth";
/** Built-in sources (also seeded by the migration); recreated if missing. */
export const DEFAULT_SOURCES = {
  osm: { name: "OpenStreetMap (Overpass API)", kind: "open_data", licence: "ODbL 1.0", attribution: "© OpenStreetMap contributors", termsUrl: "https://www.openstreetmap.org/copyright" },
  upload: { name: "Uploaded business list", kind: "upload", licence: "", attribution: "", termsUrl: "" },
  manual: { name: "Added by Medoro staff", kind: "manual", licence: "", attribution: "", termsUrl: "" },
  submitted: { name: "Submitted by the pharmacy", kind: "submitted", licence: "", attribution: "", termsUrl: "" },
} as const;
export const sourceByKey = (key: keyof typeof DEFAULT_SOURCES) => db.leadSource.upsert({ where: { key }, create: { key, ...DEFAULT_SOURCES[key] }, update: {} });

export const leadCode = async (tx: Tx) => "GL-" + String(await nextSeq(tx, SEQ, "LEAD")).padStart(6, "0");

// ── Input normalisation (manual entry, imports and discovery all go through this)
export type LeadInput = {
  name: string; category: Category; ownerName: string; phone: string | null; phoneRaw: string; email: string; website: string; domain: string;
  address: string; state: string; district: string; city: string; pin: string; lat: number | null; lng: number | null; sourceUrl: string; sourceRef: string;
};
export type RawLead = Partial<Record<keyof LeadInput | "category", unknown>>;

/** Cleans one record. Errors block it; warnings are kept with it. */
export function normalizeLead(r: RawLead): { value: LeadInput; errors: string[]; warnings: string[] } {
  const errors: string[] = [], warnings: string[] = [];
  const name = clean(r.name, 160);
  if (name.length < 3) errors.push("Pharmacy name is missing or too short.");
  const phoneRaw = clean(r.phone ?? r.phoneRaw, 40);
  const phone = toE164(phoneRaw);
  if (phoneRaw && !phone) warnings.push(`Phone “${phoneRaw}” isn’t a valid Indian number; kept as text only.`);
  const emailRaw = clean(r.email, 160);
  const email = normEmail(emailRaw);
  if (emailRaw && !email) warnings.push(`Email “${emailRaw}” isn’t valid; dropped.`);
  const websiteRaw = clean(r.website, 300);
  const website = normWebsite(websiteRaw);
  if (websiteRaw && !website) warnings.push(`Website “${websiteRaw}” isn’t a web address; dropped.`);
  const stateRaw = clean(r.state, 80);
  const state = canonicalState(stateRaw);
  if (stateRaw && !state) errors.push(`“${stateRaw}” isn’t an Indian state or union territory.`);
  const pin = clean(r.pin, 10).replace(/\s/g, "");
  if (pin && !PIN_RE.test(pin)) errors.push(`PIN code “${pin}” must be 6 digits.`);
  if (!phone && !email && !website && !(clean(r.address) && pin)) errors.push("Needs at least a phone, email, website or an address with PIN.");
  const cat = String(r.category ?? "").toUpperCase().replace(/[^A-Z_]/g, "_");
  const category = (CATEGORY_IDS as readonly string[]).includes(cat) ? (cat as Category) : /HOSP/.test(cat) ? "HOSPITAL" : /CHAIN/.test(cat) ? "CHAIN" : "RETAIL";
  const num = (v: unknown, lo: number, hi: number) => { const n = Number(v); return v === null || v === undefined || v === "" || !Number.isFinite(n) || n < lo || n > hi ? null : n; };
  const lat = num(r.lat, 6, 38), lng = num(r.lng, 68, 98);
  return {
    value: { name, category, ownerName: clean(r.ownerName, 80), phone, phoneRaw, email, website, domain: domainOf(website), address: clean(r.address, 300), state, district: clean(r.district, 80), city: clean(r.city, 80), pin, lat, lng: lat === null ? null : lng, sourceUrl: clean(r.sourceUrl, 500), sourceRef: clean(r.sourceRef, 120) },
    errors, warnings,
  };
}

// ── Duplicate matching. A strong match is the same phone or website; a possible match is a similar name or address in the same PIN.
export type Match = { id: string; code: string; name: string; reason: string; score: number; strong: boolean };
export type Candidate = { id: string; code: string; name: string; nameKey: string; phone: string | null; domain: string; pin: string; address: string };
export const CANDIDATE_SELECT = { id: true, code: true, name: true, nameKey: true, phone: true, domain: true, pin: true, address: true } as const;

/** Pure matcher over already-loaded candidates. */
export function matchRows(v: Pick<LeadInput, "name" | "phone" | "domain" | "pin" | "address">, rows: Candidate[], excludeId?: string): Match[] {
  const key = nameKey(v.name), addr = addressKey(v.address);
  const out: Match[] = [];
  for (const r of rows) {
    if (r.id === excludeId) continue;
    if (v.phone && r.phone === v.phone) { out.push({ id: r.id, code: r.code, name: r.name, reason: "Same phone number", score: 1, strong: true }); continue; }
    if (v.domain && r.domain === v.domain) { out.push({ id: r.id, code: r.code, name: r.name, reason: "Same website", score: 1, strong: true }); continue; }
    if (v.pin && r.pin === v.pin) {
      const ns = similarity(key, r.nameKey);
      const as = addr.length > 8 ? similarity(addr, addressKey(r.address)) : 0;
      if (ns >= 0.85) out.push({ id: r.id, code: r.code, name: r.name, reason: `Similar name in PIN ${v.pin} (${Math.round(ns * 100)}%)`, score: ns, strong: false });
      else if (as >= 0.9) out.push({ id: r.id, code: r.code, name: r.name, reason: `Similar address in PIN ${v.pin} (${Math.round(as * 100)}%)`, score: as, strong: false });
    }
  }
  return out.sort((a, b) => Number(b.strong) - Number(a.strong) || b.score - a.score).slice(0, 10);
}

export async function loadCandidates(tx: Db, q: { phones: string[]; domains: string[]; pins: string[] }): Promise<Candidate[]> {
  const or: Prisma.PharmacyLeadWhereInput[] = [];
  if (q.phones.length) or.push({ phone: { in: q.phones } });
  if (q.domains.length) or.push({ domain: { in: q.domains } });
  if (q.pins.length) or.push({ pin: { in: q.pins } });
  if (!or.length) return [];
  return tx.pharmacyLead.findMany({ where: { OR: or, deletedAt: null, duplicateOfId: null }, select: CANDIDATE_SELECT, take: 50_000 });
}

export async function findMatches(tx: Db, v: Pick<LeadInput, "name" | "phone" | "domain" | "pin" | "address">, excludeId?: string): Promise<Match[]> {
  const rows = await loadCandidates(tx, { phones: v.phone ? [v.phone] : [], domains: v.domain ? [v.domain] : [], pins: v.pin ? [v.pin] : [] });
  return matchRows(v, rows, excludeId);
}

/** Creates a lead inside a transaction. Strong duplicates are refused; possible duplicates go to the review queue. */
export async function insertLead(tx: Tx, v: LeadInput, opts: { sourceId: string | null; by: { id: string; name: string }; importJobId?: string; kind?: string }) {
  const code = await leadCode(tx);
  const matches = await findMatches(tx, v);
  const strong = matches.find((m) => m.strong);
  if (strong) return { created: null, strong, possible: [] as Match[], erased: false };
  const suppressed = await suppressionFor(v, "phone", tx) ?? await suppressionFor(v, "email", tx);
  // A pharmacy that asked to be erased isn't collected again.
  if (suppressed?.reason === "erasure") return { created: null, strong: null, possible: [] as Match[], erased: true };
  const lead = await tx.pharmacyLead.create({
    data: { code, ...v, nameKey: nameKey(v.name), sourceId: opts.sourceId, possibleDuplicate: matches.length > 0, importJobId: opts.importJobId ?? null, createdById: opts.by.id, stage: suppressed ? "DO_NOT_CONTACT" : "NEW_LEAD" },
  });
  for (const m of matches) await tx.leadDuplicateCandidate.create({ data: { leadId: lead.id, matchId: m.id, reason: m.reason, score: m.score } });
  await activity(tx, lead.id, opts.kind ?? "created", `${opts.kind === "imported" ? "Imported" : "Added"}${matches.length ? ` · ${matches.length} possible duplicate${matches.length > 1 ? "s" : ""} queued for review` : ""}${suppressed ? " · on the do-not-contact list" : ""}`, opts.by);
  await tx.leadEvidence.create({ data: { leadId: lead.id, kind: "source", method: "source_listing", result: "info", detail: `Collected from source${opts.importJobId ? " (import)" : ""}`, url: v.sourceUrl, byStaffId: opts.by.id } });
  await rescore(tx, lead.id);
  return { created: lead, strong: null, possible: matches, erased: false };
}

export const leadSchema = z.object({
  name: z.string(), category: z.string().optional(), ownerName: z.string().optional(), phone: z.string().optional(), email: z.string().optional(), website: z.string().optional(),
  address: z.string().optional(), state: z.string().optional(), district: z.string().optional(), city: z.string().optional(), pin: z.string().optional(), sourceUrl: z.string().optional(),
});

export async function createLead(a: Actor, raw: z.input<typeof leadSchema>) {
  need(a, "leads.create");
  const n = normalizeLead(leadSchema.parse(raw));
  if (n.errors.length) throw new UserError(n.errors[0]);
  const source = await sourceByKey("manual");
  const r = await db.$transaction((tx) => insertLead(tx, n.value, { sourceId: source?.id ?? null, by: a }));
  if (r.erased) throw new UserError("This pharmacy asked for its data to be erased and is on the do-not-contact list.");
  if (r.strong) throw new UserError(`Already a lead: ${r.strong.code} · ${r.strong.name} (${r.strong.reason.toLowerCase()}).`);
  await gaudit(a, "Lead created", "lead", r.created!.id, r.created!.code);
  return { id: r.created!.id, code: r.created!.code, possible: r.possible.length, warnings: n.warnings };
}

/** Edits facts. A changed phone, email, website or address withdraws its earlier verification. */
export async function updateLead(a: Actor, id: string, raw: z.input<typeof leadSchema> & { updatedAt: string }) {
  need(a, "leads.edit");
  const lead = await findLead(a, id);
  if (lead.erasedAt) throw new UserError("This lead was erased.");
  if (new Date(raw.updatedAt).getTime() !== lead.updatedAt.getTime()) throw new UserError("Someone changed this lead since you opened it. Reload and try again.");
  const n = normalizeLead(leadSchema.parse(raw));
  if (n.errors.length) throw new UserError(n.errors[0]);
  const v = n.value;
  if (v.phone && v.phone !== lead.phone) {
    const dup = (await findMatches(db, { ...v, name: "", pin: "", address: "", domain: "" }, id)).find((m) => m.strong);
    if (dup) throw new UserError(`That phone belongs to ${dup.code} · ${dup.name}. Merge the two from Lead verification instead.`);
  }
  const reset: Prisma.PharmacyLeadUpdateInput = {};
  const withdrawn: string[] = [];
  if (v.phone !== lead.phone && lead.phoneVerifiedAt) { reset.phoneVerifiedAt = null; withdrawn.push("phone"); }
  if (v.email !== lead.email && lead.emailVerifiedAt) { reset.emailVerifiedAt = null; withdrawn.push("email"); }
  if (v.website !== lead.website && lead.websiteVerifiedAt) { reset.websiteVerifiedAt = null; withdrawn.push("website"); }
  if ((v.address !== lead.address || v.pin !== lead.pin) && lead.locationVerifiedAt) { reset.locationVerifiedAt = null; withdrawn.push("location"); }
  // Sales employees can correct contact facts, not reshape the record.
  const data = a.growthRole === "sales"
    ? { ownerName: v.ownerName, phone: v.phone, phoneRaw: v.phoneRaw, email: v.email, website: v.website, domain: v.domain }
    : { name: v.name, nameKey: nameKey(v.name), category: v.category, ownerName: v.ownerName, phone: v.phone, phoneRaw: v.phoneRaw, email: v.email, website: v.website, domain: v.domain, address: v.address, state: v.state, district: v.district, city: v.city, pin: v.pin };
  await db.$transaction(async (tx) => {
    await tx.pharmacyLead.update({ where: { id }, data: { ...data, ...reset, ownerVerified: v.ownerName === lead.ownerName ? lead.ownerVerified : false } });
    for (const k of withdrawn) await tx.leadEvidence.create({ data: { leadId: id, kind: k, method: "manual_review", result: "withdrawn", detail: `Verification withdrawn: the ${k} was changed`, byStaffId: a.id } });
    await activity(tx, id, "note", `Details edited${withdrawn.length ? `; ${withdrawn.join(", ")} verification withdrawn` : ""}`, a);
    await syncVerification(tx, id);
    await rescore(tx, id);
  });
  await gaudit(a, "Lead edited", "lead", id, lead.code);
}

export async function syncVerification(tx: Db, id: string) {
  const l = await tx.pharmacyLead.findUniqueOrThrow({ where: { id } });
  const v = deriveVerification(l);
  if (v !== l.verification) await tx.pharmacyLead.update({ where: { id }, data: { verification: v } });
  return v;
}

export async function scoreFacts(tx: Db, id: string): Promise<ScoreFacts> {
  const l = await tx.pharmacyLead.findUniqueOrThrow({ where: { id } });
  const [calls, demo, conv] = await Promise.all([
    tx.callSession.findMany({ where: { leadId: id, outcome: { not: null } }, select: { outcome: true } }),
    tx.demoBooking.count({ where: { leadId: id, status: { not: "cancelled" } } }),
    tx.conversionRecord.count({ where: { leadId: id } }),
  ]);
  const rank = ["NOT_INTERESTED", "DO_NOT_CONTACT", "CONNECTED", "FOLLOW_UP_REQUIRED", "INTERESTED", "DEMO_SCHEDULED", "CONVERTED"];
  let best: string | null = null;
  for (const c of calls) if (c.outcome && rank.includes(c.outcome) && (!best || rank.indexOf(c.outcome) > rank.indexOf(best))) best = c.outcome;
  return { ...l, bestOutcome: best, demo: demo > 0, converted: conv > 0 };
}

export async function rescore(tx: Db, id: string) {
  const s = computeScore(await scoreFacts(tx, id));
  const l = await tx.pharmacyLead.findUniqueOrThrow({ where: { id }, select: { score: true, scoredAt: true } });
  if (l.score !== s.total || !l.scoredAt) {
    await tx.pharmacyLead.update({ where: { id }, data: { score: s.total, scoredAt: new Date() } });
    await tx.leadScore.create({ data: { leadId: id, total: s.total, breakdown: s.lines } });
  }
  return s;
}

/** Recomputes scores (POST /leads/score). */
export async function rescoreLeads(a: Actor, ids: string[]) {
  need(a, "leads.verify");
  const leads = await db.pharmacyLead.findMany({ where: { AND: [{ id: { in: ids.slice(0, 500) } }, leadScope(a)] }, select: { id: true } });
  for (const l of leads) await rescore(db, l.id);
  return leads.length;
}

// ── Search and lists
export const filterSchema = z.object({
  q: z.string().trim().max(100).optional(), state: z.string().max(80).optional(), district: z.string().max(80).optional(), city: z.string().max(80).optional(),
  pin: z.string().max(6).optional(), verification: z.string().max(30).optional(), stage: z.string().max(40).optional(), staffId: z.string().max(40).optional(),
  sourceId: z.string().max(40).optional(), minScore: z.coerce.number<string | number>().min(0).max(100).optional(), website: z.string().max(200).optional(),
  page: z.coerce.number<string | number>().int().min(1).max(10_000).default(1), pageSize: z.coerce.number<string | number>().int().min(10).max(200).default(50),
  sort: z.enum(["recent", "score", "name", "followup"]).default("recent"),
  phone: z.enum(["", "yes", "no"]).optional(),
});
export type LeadFilter = z.input<typeof filterSchema>;

export function filterWhere(a: Actor, f: z.output<typeof filterSchema>): Prisma.PharmacyLeadWhereInput {
  const and: Prisma.PharmacyLeadWhereInput[] = [leadScope(a)];
  if (f.q) {
    const p = toE164(f.q), d = domainOf(f.q);
    and.push({ OR: [{ name: { contains: f.q, mode: "insensitive" } }, { code: { equals: f.q.toUpperCase() } }, { city: { contains: f.q, mode: "insensitive" } }, ...(p ? [{ phone: p }] : [{ phoneRaw: { contains: f.q } }]), ...(d ? [{ domain: d }] : [])] });
  }
  if (f.state) and.push({ state: f.state });
  if (f.district) and.push({ district: { equals: f.district, mode: "insensitive" } });
  if (f.city) and.push({ city: { equals: f.city, mode: "insensitive" } });
  if (f.pin) and.push({ pin: f.pin });
  if (f.website) { const d = domainOf(f.website); if (d) and.push({ domain: d }); }
  if (f.verification) and.push({ verification: f.verification as never });
  if (f.stage && (STAGE_IDS as readonly string[]).includes(f.stage)) and.push({ stage: f.stage as never });
  if (f.staffId === "none") and.push({ assignedStaffId: null });
  else if (f.staffId) and.push({ assignedStaffId: f.staffId });
  if (f.sourceId) and.push({ sourceId: f.sourceId });
  if (f.phone === "yes") and.push({ phone: { not: null } });
  else if (f.phone === "no") and.push({ phone: null });
  if (f.minScore !== undefined) and.push({ score: { gte: f.minScore } });
  return { AND: and };
}

const ORDER: Record<string, Prisma.PharmacyLeadOrderByWithRelationInput[]> = {
  recent: [{ createdAt: "desc" }], score: [{ score: "desc" }, { createdAt: "desc" }], name: [{ name: "asc" }], followup: [{ nextFollowUpAt: { sort: "asc", nulls: "last" } }],
};

export async function listLeads(a: Actor, raw: LeadFilter) {
  need(a, "leads.view");
  const f = filterSchema.parse(raw);
  const where = filterWhere(a, f);
  const [total, rows] = await Promise.all([
    db.pharmacyLead.count({ where }),
    db.pharmacyLead.findMany({ where, orderBy: ORDER[f.sort], skip: (f.page - 1) * f.pageSize, take: f.pageSize, include: { source: { select: { name: true } } } }),
  ]);
  const staff = await staffNames(rows.map((r) => r.assignedStaffId));
  return {
    total, page: f.page, pageSize: f.pageSize,
    rows: rows.map((r) => ({
      id: r.id, code: r.code, name: r.name, category: r.category, phone: r.phone, phoneRaw: r.phoneRaw, email: r.email, website: r.website, city: r.city, district: r.district, state: r.state, pin: r.pin,
      verification: r.verification, score: r.score, stage: r.stage, source: r.source?.name ?? "", assignee: r.assignedStaffId ? staff.get(r.assignedStaffId) ?? "" : "", assignedStaffId: r.assignedStaffId,
      lastContactedAt: r.lastContactedAt?.toISOString() ?? null, nextFollowUpAt: r.nextFollowUpAt?.toISOString() ?? null, possibleDuplicate: r.possibleDuplicate, createdAt: r.createdAt.toISOString(),
    })),
  };
}

export async function staffNames(ids: (string | null | undefined)[]) {
  const u = [...new Set(ids.filter(Boolean) as string[])];
  const rows = u.length ? await db.staffUser.findMany({ where: { id: { in: u } }, select: { id: true, name: true } }) : [];
  return new Map(rows.map((r) => [r.id, r.name]));
}

/** Facets for the filter bar, from leads the actor can see. */
export async function facets(a: Actor) {
  const scope = leadScope(a);
  const [states, sources] = await Promise.all([
    db.pharmacyLead.groupBy({ by: ["state"], where: scope, _count: true, orderBy: { state: "asc" } }),
    db.leadSource.findMany({ where: { active: true }, select: { id: true, name: true, key: true }, orderBy: { name: "asc" } }),
  ]);
  return { states: states.filter((s) => s.state).map((s) => ({ state: s.state, n: s._count })), sources };
}

export async function leadDetail(a: Actor, id: string) {
  need(a, "leads.view");
  const l = await findLead(a, id);
  const [source, contacts, evidence, notes, activities, calls, followUps, assignments, consents, dupes, demos, conversion, deal, scoreNow, sup, convs] = await Promise.all([
    l.sourceId ? db.leadSource.findUnique({ where: { id: l.sourceId } }) : null,
    db.pharmacyContact.findMany({ where: { leadId: id, deletedAt: null }, orderBy: { createdAt: "asc" } }),
    db.leadEvidence.findMany({ where: { leadId: id }, orderBy: { at: "desc" }, take: 50 }),
    db.leadNote.findMany({ where: { leadId: id, deletedAt: null }, orderBy: { at: "desc" }, take: 50 }),
    db.leadActivity.findMany({ where: { leadId: id }, orderBy: { at: "desc" }, take: 100 }),
    db.callSession.findMany({ where: { leadId: id }, orderBy: { launchedAt: "desc" }, take: 50 }),
    db.followUpTask.findMany({ where: { leadId: id }, orderBy: { dueAt: "desc" }, take: 30 }),
    db.leadAssignment.findMany({ where: { leadId: id }, orderBy: { assignedAt: "desc" }, take: 30 }),
    db.contactConsent.findMany({ where: { leadId: id }, orderBy: { grantedAt: "desc" } }),
    db.leadDuplicateCandidate.findMany({ where: { OR: [{ leadId: id }, { matchId: id }], status: "open" } }),
    db.demoBooking.findMany({ where: { leadId: id }, orderBy: { at: "desc" } }),
    db.conversionRecord.findUnique({ where: { leadId: id } }),
    db.salesDeal.findUnique({ where: { leadId: id } }),
    scoreFacts(db, id).then(computeScore),
    Promise.all([suppressionFor(l, "phone"), suppressionFor(l, "whatsapp"), suppressionFor(l, "email")]),
    db.messageConversation.findMany({ where: { leadId: id }, select: { id: true, channel: true, lastMessageAt: true } }),
  ]);
  const names = await staffNames([...calls.map((c) => c.staffId), ...followUps.map((f) => f.staffId), ...assignments.flatMap((x) => [x.staffId, x.assignedById]), ...demos.map((d) => d.staffId), conversion?.staffId, l.assignedStaffId]);
  const dupLeads = dupes.length ? await db.pharmacyLead.findMany({ where: { id: { in: dupes.map((d) => (d.leadId === id ? d.matchId : d.leadId)) } }, select: { id: true, code: true, name: true } }) : [];
  return {
    lead: l, source, contacts, evidence, notes, activities, followUps, consents, demos, conversion, deal, score: scoreNow, conversations: convs,
    suppression: { phone: !!sup[0], whatsapp: !!sup[1], email: !!sup[2] },
    calls: calls.map((c) => ({ ...c, staffName: names.get(c.staffId) ?? "" })),
    assignments: assignments.map((x) => ({ ...x, staffName: names.get(x.staffId) ?? "", byName: names.get(x.assignedById) ?? "" })),
    duplicates: dupes.map((d) => ({ ...d, other: dupLeads.find((x) => x.id === (d.leadId === id ? d.matchId : d.leadId)) })),
    assignee: l.assignedStaffId ? names.get(l.assignedStaffId) ?? "" : "",
    names: Object.fromEntries(names),
  };
}

export async function addNote(a: Actor, leadId: string, text: string) {
  need(a, "leads.view");
  const t = z.string().trim().min(1, "Write a note.").max(2000).parse(text);
  await findLead(a, leadId);
  await db.$transaction(async (tx) => {
    const n = await tx.leadNote.create({ data: { leadId, staffId: a.id, staffName: a.name, text: t } });
    await activity(tx, leadId, "note", t.slice(0, 200), a, n.id);
  });
}

export const contactSchema = z.object({ name: z.string().trim().min(2).max(80), role: z.enum(["owner", "manager", "pharmacist", "other"]), phone: z.string().max(30).optional(), email: z.string().max(160).optional() });
export async function addContact(a: Actor, leadId: string, raw: z.input<typeof contactSchema>) {
  need(a, "leads.edit");
  const i = contactSchema.parse(raw);
  await findLead(a, leadId);
  const phone = i.phone ? toE164(i.phone) : null;
  if (i.phone && !phone) throw new UserError("Enter a valid Indian phone number.");
  await db.$transaction(async (tx) => {
    const c = await tx.pharmacyContact.create({ data: { leadId, name: i.name, role: i.role, phone, email: normEmail(i.email), provenance: "user_provided", createdById: a.id } });
    await activity(tx, leadId, "note", `Contact added: ${i.name} (${i.role}), as told to ${a.name}`, a, c.id);
  });
}

// ── Export (admin and managers), formula-safe CSV, audited and rate limited.
export async function exportLeads(a: Actor, raw: LeadFilter, purpose: string) {
  need(a, "leads.export");
  const why = z.string().trim().min(5, "Say what the export is for.").max(200).parse(purpose);
  const r = await hit({ name: "growthExport", limit: 5, windowSec: 3600, what: "lead exports" }, a.id);
  if (!r.ok) throw new UserError("Too many lead exports. Try again within the hour.");
  const f = filterSchema.parse({ ...raw, page: 1, pageSize: 200 });
  const where: Prisma.PharmacyLeadWhereInput = { AND: [filterWhere(a, f), { erasedAt: null }, { OR: [{ sourceId: null }, { source: { allowsExport: true } }] }] };
  const rows = await db.pharmacyLead.findMany({ where, orderBy: { createdAt: "asc" }, take: 20_000, include: { source: true } });
  const names = await staffNames(rows.map((x) => x.assignedStaffId));
  const csv = toCsv([
    ["Lead ID", "Pharmacy", "Category", "Owner/contact", "Phone", "Email", "Website", "Address", "City", "District", "State", "PIN", "Source", "Source URL", "Source licence / attribution", "Collected", "Verification", "Score", "Stage", "Assigned to", "Last contacted", "Next follow-up", "Created", "Updated"],
    ...rows.map((l) => [l.code, l.name, l.category, l.ownerVerified ? l.ownerName : "", l.phone ?? l.phoneRaw, l.email, l.website, l.address, l.city, l.district, l.state, l.pin, l.source?.name ?? "", l.sourceUrl, [l.source?.licence, l.source?.attribution].filter(Boolean).join(" · "), l.collectedAt.toISOString().slice(0, 10), l.verification, l.score, l.stage, l.assignedStaffId ? names.get(l.assignedStaffId) ?? "" : "", l.lastContactedAt?.toISOString() ?? "", l.nextFollowUpAt?.toISOString() ?? "", l.createdAt.toISOString(), l.updatedAt.toISOString()]),
  ]);
  await gaudit(a, "Leads exported", "lead", null, `${rows.length} rows · ${why} · filter ${JSON.stringify(f)}`);
  return { csv, count: rows.length };
}


// ── Lead sources (settings): licence, attribution and whether records may be exported.
export const sourceSchema = z.object({
  id: z.string().uuid().optional(), name: z.string().trim().min(3).max(100),
  kind: z.enum(["open_data", "public_directory", "official_api", "provider", "upload", "submitted", "manual"]),
  licence: z.string().trim().max(100).default(""), attribution: z.string().trim().max(200).default(""), termsUrl: z.string().trim().max(300).default(""),
  allowsExport: z.boolean().default(true), active: z.boolean().default(true),
});
export async function saveSource(a: Actor, raw: z.input<typeof sourceSchema>) {
  need(a, "settings.manage");
  const i = sourceSchema.parse(raw);
  const { id, ...data } = i;
  const s = id ? await db.leadSource.update({ where: { id }, data }) : await db.leadSource.create({ data: { ...data, key: "custom:" + i.name.toLowerCase().replace(/[^a-z0-9]+/g, "-") } });
  await gaudit(a, "Lead source saved", "source", s.id, `${s.name} · export ${s.allowsExport ? "allowed" : "not allowed"}`);
  return s.id;
}
