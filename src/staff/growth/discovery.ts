import "server-only";
import { z } from "zod";
import { db } from "@/server/db";
import { UserError } from "@/server/action";
import { nextSeq } from "@/server/sequence";
import { gaudit, need, type Actor } from "./access";
import { INDIAN_STATES, PIN_RE } from "./constants";
import { insertLead, normalizeLead, sourceByKey } from "./leads";
import { enqueue } from "./jobs";

/**
 * Pharmacy discovery from OpenStreetMap through the Overpass API. OSM data is © OpenStreetMap contributors under the
 * ODbL: Medoro keeps the attribution with every lead (source + link to the OSM object) and shows it wherever OSM data is
 * displayed or exported. One query per run, a descriptive User-Agent and the public instance's usage limits are respected
 * (OVERPASS_URL can point to your own instance). No Google Maps or other scraping.
 */
export const OSM_ATTRIBUTION = "© OpenStreetMap contributors, data available under the Open Database Licence (ODbL)";
export const overpassUrl = () => process.env.OVERPASS_URL || "https://overpass-api.de/api/interpreter";
export const osmEnabled = () => (process.env.GROWTH_OSM ?? "on").toLowerCase() !== "off";

export const discoverSchema = z.object({
  state: z.enum(INDIAN_STATES),
  district: z.string().trim().max(80).default(""),
  city: z.string().trim().max(80).default(""),
  pin: z.string().trim().default("").refine((p) => !p || PIN_RE.test(p), "PIN code must be 6 digits."),
});
export type DiscoverInput = z.output<typeof discoverSchema>;

const q = (s: string) => s.replace(/["\\]/g, "").replace(/[.*+?^${}()|[\]]/g, "\\$&");

/** Overpass QL for pharmacies in an Indian state, narrowed to a district, city or PIN. */
export function overpassQuery(i: DiscoverInput, limit = 1500) {
  const lines = ["[out:json][timeout:90];", `area["admin_level"="4"]["name:en"~"^${q(i.state)}$",i]->.s;`];
  let area = ".s";
  const place = i.city || i.district;
  // Match the boundary's name or its English name (some carry the local-script name as "name").
  if (place) { lines.push("(", `  rel["boundary"="administrative"]["name"~"^${q(place)}$",i](area.s);`, `  rel["boundary"="administrative"]["name:en"~"^${q(place)}$",i](area.s);`, ");", "map_to_area->.p;"); area = ".p"; }
  // PIN codes are rarely tagged on Indian pharmacies in OpenStreetMap, so the PIN is not part of the query: it is
  // applied afterwards (pinMatches), keeping pharmacies with no recorded PIN.
  lines.push("(", `  nwr["amenity"="pharmacy"](area${area});`, `  nwr["healthcare"="pharmacy"](area${area});`, ");", `out center tags ${limit};`);
  return lines.join("\n");
}

type OsmEl = { type: string; id: number; lat?: number; lon?: number; center?: { lat: number; lon: number }; tags?: Record<string, string> };
/** With a PIN searched: drop pharmacies whose recorded PIN differs; keep those with none (OSM rarely has one). */
export const pinMatches = (el: OsmEl, pin: string) => { const p = (el.tags?.["addr:postcode"] ?? "").replace(/\s/g, ""); return !pin || !p || p === pin; };

/** One OSM element → a raw lead. */
export function fromOsm(el: OsmEl, i: DiscoverInput) {
  const t = el.tags ?? {};
  const street = [t["addr:housenumber"], t["addr:street"], t["addr:suburb"] ?? t["addr:place"]].filter(Boolean).join(", ");
  return {
    name: t.name ?? t["name:en"] ?? t.brand ?? "",
    category: t.healthcare === "pharmacy" && t.amenity !== "pharmacy" ? "OTHER" : t.brand || t.operator?.match(/apollo|medplus|wellness|netmeds|1mg|frank ross|guardian/i) ? "CHAIN" : "RETAIL",
    phone: (t.phone ?? t["contact:phone"] ?? t["contact:mobile"] ?? "").split(/[;,]/)[0],
    email: t.email ?? t["contact:email"] ?? "",
    website: t.website ?? t["contact:website"] ?? "",
    address: t["addr:full"] ?? street,
    city: t["addr:city"] ?? i.city,
    district: t["addr:district"] ?? i.district,
    state: i.state,
    // Only a PIN OpenStreetMap records: the searched PIN is never copied onto a pharmacy.
    pin: (t["addr:postcode"] ?? "").replace(/\s/g, ""),
    lat: el.lat ?? el.center?.lat ?? null,
    lng: el.lon ?? el.center?.lon ?? null,
    sourceRef: `osm:${el.type}/${el.id}`,
    sourceUrl: `https://www.openstreetmap.org/${el.type}/${el.id}`,
  };
}

export async function startDiscovery(a: Actor, raw: z.input<typeof discoverSchema>) {
  need(a, "leads.discover");
  if (!osmEnabled()) throw new UserError("OpenStreetMap discovery is switched off on this server (GROWTH_OSM=off).");
  const i = discoverSchema.parse(raw);
  const source = await sourceByKey("osm");
  const label = [i.pin, i.city, i.district, i.state].filter(Boolean).join(", ");
  const job = await db.$transaction(async (tx) => {
    const code = "IMP-" + String(await nextSeq(tx, "_growth", "IMPORT")).padStart(5, "0");
    return tx.leadImportJob.create({ data: { code, fileName: `OpenStreetMap: ${label}`, sourceId: source.id, status: "running", mapping: i, createdById: a.id } });
  });
  await enqueue("osm_discovery", { importJobId: job.id, ...i }, { key: `osm:${job.id}`, by: a.id, maxAttempts: 3 });
  await gaudit(a, "Discovery started", "import", job.id, `${job.code} · OpenStreetMap · ${label}`);
  // Try it now; if Overpass is busy the queued job retries with backoff. Safe twice: inserts skip known OSM objects.
  await runDiscovery({ importJobId: job.id, ...i }).catch(() => {});
  const after = await db.leadImportJob.findUniqueOrThrow({ where: { id: job.id } });
  return { id: job.id, code: job.code, status: after.status, created: after.created };
}

/** Background handler: one Overpass query, then idempotent inserts (an OSM object already on file is skipped). */
export async function runDiscovery(payload: { importJobId: string } & DiscoverInput, fetchImpl: typeof fetch = fetch) {
  const job = await db.leadImportJob.findUnique({ where: { id: payload.importJobId } });
  if (!job || job.status !== "running") return;
  const res = await fetchImpl(overpassUrl(), {
    method: "POST", signal: AbortSignal.timeout(120_000),
    headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "MedoroGrowth/1.0 (+https://medoro.in; pharmacy discovery)" },
    body: "data=" + encodeURIComponent(overpassQuery(payload)),
  });
  if (res.status === 429 || res.status === 504) throw new Error(`Overpass is busy (HTTP ${res.status}); will retry`);
  if (!res.ok) throw new Error(`Overpass answered HTTP ${res.status}`);
  const all = ((await res.json()) as { elements?: OsmEl[] }).elements ?? [];
  const els = all.filter((el) => pinMatches(el, payload.pin));
  const by = { id: job.createdById, name: "OpenStreetMap discovery" };
  let created = 0, duplicates = 0, possible = 0, invalid = 0;
  const errors: { line: number; name: string; errors: string[] }[] = [];
  for (const [n, el] of els.entries()) {
    const raw = fromOsm(el, payload);
    if (await db.pharmacyLead.findFirst({ where: { sourceId: job.sourceId, sourceRef: raw.sourceRef }, select: { id: true } })) { duplicates++; continue; }
    const norm = normalizeLead(raw);
    // A pharmacy on the map with no phone or address is still worth researching: its map position is its location.
    const errs = norm.errors.filter((e) => !(e.startsWith("Needs at least") && norm.value.lat !== null));
    if (errs.length) { invalid++; errors.push({ line: n + 1, name: raw.name || raw.sourceRef, errors: errs }); continue; }
    const r = await db.$transaction((tx) => insertLead(tx, norm.value, { sourceId: job.sourceId, by, importJobId: job.id, kind: "imported" }));
    if (r.created) { created++; if (r.possible.length) possible++; if (!r.created.phone && !r.created.email) await db.pharmacyLead.update({ where: { id: r.created.id }, data: { stage: "RESEARCH_PENDING" } }); }
    else duplicates++;
  }
  await db.leadImportJob.update({ where: { id: job.id }, data: { status: "completed", finishedAt: new Date(), totalRows: els.length, processed: els.length, created, duplicates, possibleDuplicates: possible, invalid, errors } });
}
