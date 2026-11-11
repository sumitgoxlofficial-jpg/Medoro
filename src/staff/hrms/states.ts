// Indian states and union territories with their main language, used to give a salesperson the leads they can talk to
// in their own language: a salesperson from Bihar gets leads from Hindi-speaking states only. Pure data, no server code.

export type Lang = "hindi" | "marathi" | "gujarati" | "bengali" | "odia" | "punjabi" | "tamil" | "telugu" | "kannada" | "malayalam" | "assamese" | "konkani" | "kashmiri" | "nepali" | "english";
export const STATE_LANG: Record<string, Lang> = {
  "Bihar": "hindi", "Jharkhand": "hindi", "Uttar Pradesh": "hindi", "Madhya Pradesh": "hindi", "Chhattisgarh": "hindi", "Rajasthan": "hindi", "Haryana": "hindi",
  "Delhi": "hindi", "Uttarakhand": "hindi", "Himachal Pradesh": "hindi", "Chandigarh": "hindi",
  "Maharashtra": "marathi", "Gujarat": "gujarati", "West Bengal": "bengali", "Odisha": "odia", "Punjab": "punjabi",
  "Tamil Nadu": "tamil", "Puducherry": "tamil", "Telangana": "telugu", "Andhra Pradesh": "telugu", "Karnataka": "kannada", "Kerala": "malayalam",
  "Assam": "assamese", "Goa": "konkani", "Jammu and Kashmir": "kashmiri", "Sikkim": "nepali",
  "Arunachal Pradesh": "english", "Manipur": "english", "Meghalaya": "english", "Mizoram": "english", "Nagaland": "english", "Tripura": "bengali", "Ladakh": "hindi",
};
export const STATES = Object.keys(STATE_LANG).sort();
export const langLabel = (l: string) => l.charAt(0).toUpperCase() + l.slice(1);

const ALIAS: Record<string, string> = {
  up: "Uttar Pradesh", "u.p.": "Uttar Pradesh", mp: "Madhya Pradesh", "m.p.": "Madhya Pradesh", cg: "Chhattisgarh", chattisgarh: "Chhattisgarh", hp: "Himachal Pradesh",
  uk: "Uttarakhand", uttaranchal: "Uttarakhand", orissa: "Odisha", bengal: "West Bengal", wb: "West Bengal", tn: "Tamil Nadu", tamilnadu: "Tamil Nadu", ap: "Andhra Pradesh",
  "j&k": "Jammu and Kashmir", jk: "Jammu and Kashmir", "jammu & kashmir": "Jammu and Kashmir", "new delhi": "Delhi", "nct of delhi": "Delhi", pondicherry: "Puducherry", ka: "Karnataka",
};
/** "bihar", "BIHAR", "U.P." → the standard state name, or "" when it isn't one. */
export function stateName(raw: string): string {
  const t = raw.trim().toLowerCase().replace(/\s+/g, " ");
  if (!t) return "";
  return ALIAS[t] ?? STATES.find((s) => s.toLowerCase() === t) ?? "";
}

/** A guess from the town, for sheets with no state column. Only well-known towns; anything else stays unknown. */
const CITY: Record<string, string> = {
  patna: "Bihar", gaya: "Bihar", muzaffarpur: "Bihar", bhagalpur: "Bihar", darbhanga: "Bihar", purnia: "Bihar", arrah: "Bihar", begusarai: "Bihar", chapra: "Bihar", hajipur: "Bihar", sasaram: "Bihar", katihar: "Bihar", motihari: "Bihar", siwan: "Bihar",
  ranchi: "Jharkhand", bokaro: "Jharkhand", dhanbad: "Jharkhand", jamshedpur: "Jharkhand", hazaribagh: "Jharkhand", hazaribag: "Jharkhand", deoghar: "Jharkhand", giridih: "Jharkhand", ramgarh: "Jharkhand", chaibasa: "Jharkhand", dumka: "Jharkhand", chas: "Jharkhand", "bokaro steel city": "Jharkhand",
  lucknow: "Uttar Pradesh", kanpur: "Uttar Pradesh", varanasi: "Uttar Pradesh", agra: "Uttar Pradesh", prayagraj: "Uttar Pradesh", allahabad: "Uttar Pradesh", noida: "Uttar Pradesh", ghaziabad: "Uttar Pradesh", meerut: "Uttar Pradesh", gorakhpur: "Uttar Pradesh", bareilly: "Uttar Pradesh",
  bhopal: "Madhya Pradesh", indore: "Madhya Pradesh", jabalpur: "Madhya Pradesh", gwalior: "Madhya Pradesh", raipur: "Chhattisgarh", bilaspur: "Chhattisgarh", bhilai: "Chhattisgarh",
  jaipur: "Rajasthan", jodhpur: "Rajasthan", udaipur: "Rajasthan", kota: "Rajasthan", gurgaon: "Haryana", gurugram: "Haryana", faridabad: "Haryana", panipat: "Haryana", delhi: "Delhi", dehradun: "Uttarakhand", haridwar: "Uttarakhand", shimla: "Himachal Pradesh",
  mumbai: "Maharashtra", pune: "Maharashtra", nagpur: "Maharashtra", nashik: "Maharashtra", thane: "Maharashtra", ahmedabad: "Gujarat", surat: "Gujarat", vadodara: "Gujarat", rajkot: "Gujarat",
  kolkata: "West Bengal", howrah: "West Bengal", siliguri: "West Bengal", durgapur: "West Bengal", asansol: "West Bengal", bhubaneswar: "Odisha", cuttack: "Odisha", rourkela: "Odisha", ludhiana: "Punjab", amritsar: "Punjab", jalandhar: "Punjab",
  chennai: "Tamil Nadu", coimbatore: "Tamil Nadu", madurai: "Tamil Nadu", hyderabad: "Telangana", warangal: "Telangana", visakhapatnam: "Andhra Pradesh", vijayawada: "Andhra Pradesh", bengaluru: "Karnataka", bangalore: "Karnataka", mysuru: "Karnataka", mysore: "Karnataka",
  kochi: "Kerala", cochin: "Kerala", thiruvananthapuram: "Kerala", kozhikode: "Kerala", guwahati: "Assam",
};
/** The state of a lead: the one written in the sheet, else a guess from the town, else unknown (""). */
export const stateOf = (state: string, city: string) => stateName(state) || CITY[city.trim().toLowerCase()] || "";
export const langOf = (state: string): Lang | "" => STATE_LANG[stateName(state)] ?? "";
/** Can a salesperson from `home` talk to a lead in `leadState`? Unknown on either side means no restriction. */
export const speaks = (home: string, leadState: string) => { const a = langOf(home), b = langOf(leadState); return !a || !b || a === b; };
