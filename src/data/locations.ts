/**
 * Local pages: /pharmacy-software-in-<slug> (rewritten to /pharmacy-software-in/<slug>, see next.config.ts).
 *
 * Each location carries its own facts (GST state code, local trade context, nearby places) so the pages are useful
 * on their own and not copies with the name swapped. Keep local facts to things that are widely known and checkable.
 * The [name, slug] list for the footer lives in src/data/site-links.ts (TOP_CITY_LINKS); the full list is linked
 * from /pharmacy-software-in-india.
 */

export type StateInfo = {
  name: string;
  /** First two digits of every GSTIN registered in the state. */
  gstCode: string;
  /** The office that licenses and inspects pharmacies, as commonly named. */
  regulator: string;
  /** Hindi is the main language of the state. */
  hindiBelt: boolean;
};

export const STATES = {
  MH: { name: "Maharashtra", gstCode: "27", regulator: "Food and Drug Administration (FDA), Maharashtra", hindiBelt: false },
  DL: { name: "Delhi", gstCode: "07", regulator: "Drugs Control Department, Government of NCT of Delhi", hindiBelt: true },
  KA: { name: "Karnataka", gstCode: "29", regulator: "Drugs Control Department, Karnataka", hindiBelt: false },
  TG: { name: "Telangana", gstCode: "36", regulator: "Drugs Control Administration, Telangana", hindiBelt: false },
  BR: { name: "Bihar", gstCode: "10", regulator: "Drugs Control Administration, Bihar", hindiBelt: true },
  JH: { name: "Jharkhand", gstCode: "20", regulator: "the State Drugs Control office, Jharkhand", hindiBelt: true },
  WB: { name: "West Bengal", gstCode: "19", regulator: "Directorate of Drugs Control, West Bengal", hindiBelt: false },
  TN: { name: "Tamil Nadu", gstCode: "33", regulator: "Drugs Control Department, Tamil Nadu", hindiBelt: false },
  GJ: { name: "Gujarat", gstCode: "24", regulator: "Food and Drugs Control Administration (FDCA), Gujarat", hindiBelt: false },
  UP: { name: "Uttar Pradesh", gstCode: "09", regulator: "Food Safety and Drug Administration (FSDA), Uttar Pradesh", hindiBelt: true },
  RJ: { name: "Rajasthan", gstCode: "08", regulator: "Drugs Control Organisation, Rajasthan", hindiBelt: true },
} satisfies Record<string, StateInfo>;
export type StateKey = keyof typeof STATES;

export type Location = {
  slug: string;
  name: string;
  kind: "city" | "state";
  state: StateKey;
  /** One or two sentences specific to this place: who the pages are for and what's local about pharmacy trade there. */
  local: string;
  /** Facts specific to this place, shown as a short list. */
  context: string[];
  /** Other location slugs to link to. */
  nearby: string[];
};

export const LOCATIONS: Location[] = [
  // Cities
  {
    slug: "mumbai", name: "Mumbai", kind: "city", state: "MH",
    local: "Mumbai's chemists run some of the longest counter hours in the country, and many owners manage two or three outlets across the suburbs.",
    context: ["High footfall counters need billing that never waits on a slow PC", "Multi-outlet owners in the suburbs need one view of every shop's sales and stock", "Many distributors share e-bills as CSV or Excel exports"],
    nearby: ["pune", "maharashtra", "ahmedabad"],
  },
  {
    slug: "delhi", name: "Delhi", kind: "city", state: "DL",
    local: "Delhi pharmacies buy from one of Asia's biggest medicine wholesale markets at Bhagirath Palace, and many stores serve customers who are happier with screens in Hindi.",
    context: ["Purchases from Bhagirath Palace wholesalers bring a high volume of distributor bills every week", "Delhi registrations charge CGST and SGST inside Delhi and IGST to buyers in Noida, Gurugram or Ghaziabad", "Full Hindi interface for counter staff"],
    nearby: ["uttar-pradesh", "lucknow", "jaipur"],
  },
  {
    slug: "bangalore", name: "Bangalore", kind: "city", state: "KA",
    local: "Bengaluru's pharmacies serve fast-growing residential layouts where home delivery and WhatsApp orders are a large share of sales.",
    context: ["Phone and WhatsApp orders with prescription photos, delivery slots and rider cash handover", "Owners checking sales and stock from the phone", "Chains expanding across new layouts"],
    nearby: ["karnataka", "chennai", "hyderabad"],
  },
  {
    slug: "hyderabad", name: "Hyderabad", kind: "city", state: "TG",
    local: "Hyderabad is known as India's bulk drug capital, and its retail pharmacies range from single counters in the old city to multi-branch chains in the IT corridors.",
    context: ["Telangana GSTINs start with 36; buyers from Andhra Pradesh are billed with IGST", "Multi-branch chains need transfers and consolidated reports", "Distributors commonly send e-bills as CSV or Excel"],
    nearby: ["bangalore", "chennai", "karnataka"],
  },
  {
    slug: "patna", name: "Patna", kind: "city", state: "BR",
    local: "Patna's Govind Mitra Road is Bihar's main medicine wholesale market, and pharmacies across the city stock from its distributors every week.",
    context: ["High purchase volumes from GM Road distributors make e-bill import a big time-saver", "Hindi interface for owners and counter staff", "Expiry returns to distributors tracked until the credit note arrives"],
    nearby: ["bihar", "ranchi", "kolkata"],
  },
  {
    slug: "ranchi", name: "Ranchi", kind: "city", state: "JH",
    local: "Ranchi is Jharkhand's capital and a medical hub for the region, with pharmacies near its large hospitals serving patients from across the state.",
    context: ["Pharmacies near hospitals handle many prescription-only and Schedule H1 sales", "Some stock comes from distributors in Kolkata or Patna, billed with IGST", "Medoro is made in Bokaro, Jharkhand, with support in Hindi"],
    nearby: ["jharkhand", "bokaro", "jamshedpur"],
  },
  {
    slug: "kolkata", name: "Kolkata", kind: "city", state: "WB",
    local: "Kolkata's Bagri Market is one of eastern India's largest medicine wholesale hubs and supplies pharmacies across Bengal and the neighbouring states.",
    context: ["West Bengal GSTINs start with 19; sales to buyers in Jharkhand, Bihar or Odisha are IGST", "Heavy distributor bill volume makes e-bill import worthwhile", "Batch-wise stock with expiry for high-turnover counters"],
    nearby: ["patna", "ranchi", "bihar"],
  },
  {
    slug: "chennai", name: "Chennai", kind: "city", state: "TN",
    local: "Chennai's pharmacies serve patients from across the country who come to the city's hospitals, often with long, multi-item prescriptions.",
    context: ["Long prescriptions billed quickly with salt and brand search", "Pharmacies near hospitals handle many Schedule H and H1 sales", "Tamil Nadu GSTINs start with 33"],
    nearby: ["bangalore", "hyderabad", "karnataka"],
  },
  {
    slug: "pune", name: "Pune", kind: "city", state: "MH",
    local: "Pune's pharmacies sit in fast-growing suburbs where many owners run a second or third branch and want to keep an eye on all of them.",
    context: ["Multi-branch stock transfers with approval", "Owner's phone view of every branch", "Maharashtra GSTINs start with 27"],
    nearby: ["mumbai", "maharashtra", "ahmedabad"],
  },
  {
    slug: "ahmedabad", name: "Ahmedabad", kind: "city", state: "GJ",
    local: "Ahmedabad sits at the centre of Gujarat's pharmaceutical industry, one of the largest in India, and its pharmacies deal with a wide range of brands and trade generics.",
    context: ["Trade generics with high margins make landed cost and margin tracking important", "PTR, PTS, free goods and schemes captured from distributor bills", "Gujarat GSTINs start with 24"],
    nearby: ["gujarat", "mumbai", "jaipur"],
  },
  {
    slug: "lucknow", name: "Lucknow", kind: "city", state: "UP",
    local: "Lucknow's pharmacies serve the city and patients travelling in from across central Uttar Pradesh for its hospitals.",
    context: ["Hindi interface for owners and counter staff", "Prescription medicines with prescriber captured on every bill", "Uttar Pradesh GSTINs start with 09"],
    nearby: ["uttar-pradesh", "delhi", "patna"],
  },
  {
    slug: "jaipur", name: "Jaipur", kind: "city", state: "RJ",
    local: "Jaipur's pharmacies range from busy old-city counters to new chains in the growing suburbs, with most staff working in Hindi.",
    context: ["Full Hindi interface", "Expiry control for slower-moving stock", "Rajasthan GSTINs start with 08"],
    nearby: ["delhi", "ahmedabad", "lucknow"],
  },
  {
    slug: "bokaro", name: "Bokaro", kind: "city", state: "JH",
    local: "Bokaro Steel City is where Medoro is made. Pharmacies here and in the nearby towns were among the first to bill on it.",
    context: ["Support from the team that builds Medoro, in Hindi and English", "Distributor bills from Dhanbad, Ranchi and Kolkata", "Jharkhand GSTINs start with 20"],
    nearby: ["dhanbad", "ranchi", "jharkhand"],
  },
  {
    slug: "jamshedpur", name: "Jamshedpur", kind: "city", state: "JH",
    local: "Jamshedpur's pharmacies serve an industrial city with large hospitals and many regular customers on monthly medicines.",
    context: ["Refill reminders on WhatsApp for customers on monthly medicines", "Customer credit with limits for regular accounts", "Jharkhand GSTINs start with 20"],
    nearby: ["ranchi", "bokaro", "jharkhand"],
  },
  {
    slug: "dhanbad", name: "Dhanbad", kind: "city", state: "JH",
    local: "Dhanbad is a trading centre for the coal belt, and its distributors and pharmacies supply towns across north Jharkhand.",
    context: ["Batch-wise stock and expiry for busy counters", "Hindi interface for counter staff", "Jharkhand GSTINs start with 20"],
    nearby: ["bokaro", "ranchi", "jharkhand"],
  },
  // States
  {
    slug: "maharashtra", name: "Maharashtra", kind: "state", state: "MH",
    local: "From Mumbai and Pune to Nagpur and Nashik, Maharashtra has one of the largest numbers of retail pharmacies in India.",
    context: ["Pharmacies are licensed by the FDA, Maharashtra", "Chains with outlets in several cities need consolidated reports", "Maharashtra GSTINs start with 27"],
    nearby: ["mumbai", "pune", "gujarat"],
  },
  {
    slug: "jharkhand", name: "Jharkhand", kind: "state", state: "JH",
    local: "Medoro is made in Jharkhand. Pharmacies in Ranchi, Jamshedpur, Dhanbad, Bokaro and the smaller towns use it in Hindi and English.",
    context: ["Many pharmacies buy from distributors in Kolkata or Patna, which arrives as IGST", "Support from the team in Bokaro", "Jharkhand GSTINs start with 20"],
    nearby: ["ranchi", "jamshedpur", "bokaro"],
  },
  {
    slug: "bihar", name: "Bihar", kind: "state", state: "BR",
    local: "Pharmacies across Bihar, from Patna to Gaya, Muzaffarpur and Bhagalpur, stock from distributors in Patna and Kolkata.",
    context: ["Full Hindi interface for owners and staff", "Distributor e-bill import for weekly purchases", "Bihar GSTINs start with 10"],
    nearby: ["patna", "jharkhand", "kolkata"],
  },
  {
    slug: "uttar-pradesh", name: "Uttar Pradesh", kind: "state", state: "UP",
    local: "Uttar Pradesh has more medical stores than almost any other state, from Lucknow and Kanpur to Varanasi, Agra and the NCR towns.",
    context: ["Pharmacies are licensed by the FSDA, Uttar Pradesh", "Full Hindi interface", "Uttar Pradesh GSTINs start with 09; Delhi distributors bill with IGST"],
    nearby: ["lucknow", "delhi", "bihar"],
  },
  {
    slug: "gujarat", name: "Gujarat", kind: "state", state: "GJ",
    local: "Gujarat is home to a large share of India's pharmaceutical manufacturing, and its pharmacies in Ahmedabad, Surat, Vadodara and Rajkot carry a wide range of brands and generics.",
    context: ["Pharmacies are licensed by the FDCA, Gujarat", "Margins on landed cost by item, category and supplier", "Gujarat GSTINs start with 24"],
    nearby: ["ahmedabad", "maharashtra", "mumbai"],
  },
  {
    slug: "karnataka", name: "Karnataka", kind: "state", state: "KA",
    local: "From Bengaluru to Mysuru, Hubballi and Mangaluru, Karnataka's pharmacies combine counter sales with a growing share of home delivery.",
    context: ["Orders and home delivery with prescription photos", "Owner's view on the phone", "Karnataka GSTINs start with 29"],
    nearby: ["bangalore", "chennai", "hyderabad"],
  },
];

export const locationBySlug = (slug: string) => LOCATIONS.find((l) => l.slug === slug);
export const locationPath = (slug: string) => `/pharmacy-software-in-${slug}`;
