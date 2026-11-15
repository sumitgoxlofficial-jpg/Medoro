/**
 * Comparison pages (/compare/[slug]) for pharmacies looking at alternatives to the software they use now.
 *
 * Rules for this file:
 * - Medoro's column only says what the product does today (README.md "What works now", src/lib/plans.ts).
 * - Competitor cells describe the typical setup from public information and say "varies" or "ask the vendor" where an
 *   edition, add-on or dealer changes the answer. Never state a competitor lacks something we have not checked.
 * - Every page shows REVIEWED and asks readers to report anything out of date. Product names are trademarks of their
 *   owners; Medoro is not affiliated with them.
 */

/** Month the competitor columns were last reviewed against public information. */
export const REVIEWED = "November 2026";

export type Support = "yes" | "partial" | "no" | "ask";
export type Cell = { v: Support; note: string };

/** The rows every comparison table shows, in order. */
export const CRITERIA = [
  { key: "cloud", label: "Cloud access from any device" },
  { key: "noServer", label: "Zero server maintenance" },
  { key: "billImport", label: "AI distributor bill import (CSV / Excel / PDF)" },
  { key: "mobile", label: "Mobile app" },
  { key: "expiry", label: "Near-expiry alerts with projected loss" },
  { key: "h1", label: "Schedule H1 register from bills" },
  { key: "hindi", label: "Hindi interface" },
  { key: "pricing", label: "Pricing published online" },
] as const;
export type CriterionKey = (typeof CRITERIA)[number]["key"];

/** Medoro's column, shared by every comparison. */
export const MEDORO: Record<CriterionKey, Cell> = {
  cloud: { v: "yes", note: "Open it in Chrome on any PC, tablet or phone, or use the desktop app" },
  noServer: { v: "yes", note: "On Medoro's hosted plan there is no server to run; data is kept encrypted in your own Google Drive" },
  billImport: { v: "yes", note: "CSV, Excel and pipe-text e-bills with saved column maps; PDF and photo scanning on Professional" },
  mobile: { v: "yes", note: "Installable app on Android and any phone browser, with an owner's view" },
  expiry: { v: "yes", note: "30–180 day windows, loss at cost, return or transfer suggestions" },
  h1: { v: "yes", note: "H1, X and NDPS sales with patient and prescriber, on screen or CSV" },
  hindi: { v: "yes", note: "Full English and हिंदी interface" },
  pricing: { v: "yes", note: "₹999, ₹2,499 and ₹4,499 a month on the website, GST included" },
};

export type Comparison = {
  slug: string;
  competitor: string;
  /** Short name for links and the footer. */
  name: string;
  title: string;
  description: string;
  keywords: string[];
  h1: string;
  intro: string;
  /** One honest paragraph on who the competitor suits. */
  verdict: string;
  them: Record<CriterionKey, Cell>;
  /** Honest pros and cons of the competitor, and of Medoro for this buyer. */
  theirPros: string[];
  theirCons: string[];
  medoroPros: string[];
  medoroCons: string[];
  /** What to export from the competitor when switching. */
  exportTip: string;
  faq: [q: string, a: string][];
};

const ask = (note = "Depends on edition and add-ons; ask the vendor"): Cell => ({ v: "ask", note });

export const COMPARISONS: Comparison[] = [
  {
    slug: "marg-erp-alternative",
    competitor: "Marg ERP",
    name: "Medoro vs Marg ERP",
    title: "Marg ERP Alternative for Pharmacy: Medoro vs Marg",
    description: "Comparing Marg ERP and Medoro for retail pharmacies: cloud access, server upkeep, distributor bill import, expiry alerts, Schedule H1 register and pricing.",
    keywords: ["marg erp alternative", "marg software alternative", "medoro vs marg", "marg pharmacy software alternative", "cloud alternative to marg erp"],
    h1: "Looking for a Marg ERP alternative for your pharmacy?",
    intro: "Marg ERP is one of the most widely used billing and accounting packages in Indian pharma retail and distribution. Medoro is a newer, cloud-first pharmacy system built only for medical stores and small chains. Here is an honest side-by-side so you can decide which suits your shop.",
    verdict: "Marg suits businesses that also run pharma distribution or wholesale, rely on a local dealer for setup and support, and are comfortable running Windows desktop software with their own backups. Medoro suits retail pharmacies and chains of up to five branches that want to bill from any device, have backups handled for them and see their numbers on the phone.",
    them: {
      cloud: { v: "partial", note: "Desktop software on a Windows PC by default; remote and online access through separate editions or add-ons" },
      noServer: { v: "no", note: "Typical installs run on a shop PC or local server that you maintain and back up" },
      billImport: { v: "partial", note: "Imports purchase data from distributors, strongest when both sides use Marg; ask about other formats" },
      mobile: { v: "partial", note: "Companion mobile apps are available; check which work with your edition" },
      expiry: { v: "partial", note: "Expiry reports and near-expiry lists" },
      h1: ask("Registers and reports are available; ask how H1 entries are captured at billing"),
      hindi: ask("Ask the vendor about Hindi screens"),
      pricing: { v: "partial", note: "Edition prices are listed; add-ons, renewals and dealer services are quoted separately" },
    },
    theirPros: [
      "Very widely used, so many staff, CAs and distributors already know it",
      "Covers pharma distribution and wholesale as well as retail",
      "Large dealer network for on-site installation and training",
      "Runs on a local PC without depending on internet",
    ],
    theirCons: [
      "Desktop-first: using it away from the shop usually needs extra setup or add-ons",
      "The PC, Windows updates and backups are your responsibility",
      "The interface takes time for new staff to learn",
      "Total cost depends on edition, add-ons, renewals and dealer charges",
    ],
    medoroPros: [
      "Use it from any counter, tablet or phone, with live sync between devices",
      "No server to look after on the hosted plan; encrypted backups to your own Google Drive",
      "Imports distributor e-bills from Marg and other software, with column maps saved per supplier",
      "90-day expiry list with projected loss and return or transfer suggestions",
      "Full Hindi interface and prices published on the website",
    ],
    medoroCons: [
      "Built for retail pharmacies: not a distribution or wholesale ERP",
      "Newer, with a smaller support team (WhatsApp and email, Mon–Sat 9 am–9 pm) and no local dealers",
      "Multi-branch plan covers up to 5 branches, with extra branches as an add-on",
    ],
    exportTip: "In Marg, export your item master, batch-wise stock, suppliers and customers to Excel from the reports menu (or ask your Marg dealer for the export). Medoro reads the files directly.",
    faq: [
      ["Can I move my data from Marg to Medoro?", "Yes. Export medicines with batch-wise stock, suppliers and customers to Excel or CSV from Marg and import them into Medoro. Every row is checked for expiry, GST rate and MRP against cost, and nothing is imported until the file is clean. Assisted migration is available if you'd rather send us the files."],
      ["Can Medoro read e-bills from distributors who use Marg?", "Yes. Medoro imports CSV, Excel and pipe-separated text files. If the columns aren't recognised automatically you map them once and the mapping is saved for that distributor."],
      ["Does Medoro work without internet like Marg?", "Yes, on the Professional plan and above, counters can keep billing when the internet drops and sync when it comes back."],
      ["Is Medoro cheaper than Marg?", "Medoro is ₹999 a month for one store on Starter, ₹2,499 on Professional and ₹4,499 for up to 5 branches, GST included. Marg's cost depends on the edition, add-ons, renewals and dealer services you need, so compare the total for your setup over two or three years."],
    ],
  },
  {
    slug: "vyapar-alternative-for-pharmacy",
    competitor: "Vyapar",
    name: "Medoro vs Vyapar",
    title: "Vyapar Alternative for Pharmacy: Medoro vs Vyapar",
    description: "Vyapar vs Medoro for medical stores: a general GST billing app vs pharmacy software with FEFO batches, Schedule H1 register, e-bill import and expiry alerts.",
    keywords: ["vyapar alternative for pharmacy", "vyapar for medical store", "medoro vs vyapar", "vyapar pharmacy billing", "vyapar alternative"],
    h1: "Outgrowing Vyapar at your medical store?",
    intro: "Vyapar is a popular, affordable GST billing and accounting app for small businesses of every kind. Medoro is built only for pharmacies. If you run a medical store on Vyapar today, here is what changes and what doesn't.",
    verdict: "Vyapar is a good fit for a small shop that needs simple GST bills and books on a phone, and for owners who sell more than medicines. Medoro is the better fit once the pharmacy-specific work takes over the day: batch and expiry, prescription medicines, distributor bills with PTR and schemes, and returns to distributors.",
    them: {
      cloud: { v: "partial", note: "Mobile and desktop apps with sync between devices on paid plans" },
      noServer: { v: "yes", note: "No server to run; the app keeps data on the device with backups" },
      billImport: { v: "partial", note: "Item import from Excel; pharmacy distributor e-bill mapping isn't its focus — ask the vendor" },
      mobile: { v: "yes", note: "Strong Android app" },
      expiry: { v: "partial", note: "Batch and expiry fields on items with stock reports" },
      h1: ask("General-purpose app; ask whether a Schedule H1 register is available"),
      hindi: ask("Ask the vendor about Hindi screens"),
      pricing: { v: "yes", note: "Plans listed on the website" },
    },
    theirPros: [
      "Low price and a free basic version for getting started",
      "Easy to learn, with an excellent mobile app",
      "Works for any kind of shop, not just pharmacies",
      "Good for quick GST invoices, estimates and payment reminders",
    ],
    theirCons: [
      "Not built around pharmacy work like FEFO batch picking and prescriber capture",
      "Salt-based search and substitutes are not its focus",
      "Distributor bills with PTR, PTS, free goods and schemes take manual work",
      "Expiry claims and returns to distributors are not tracked as a workflow",
    ],
    medoroPros: [
      "Earliest-expiring batch picked on every bill, and expired stock blocked",
      "Salt search with substitutes in stock, and loose tablet sale from strips",
      "Schedule H/H1 prescriber capture and the H1 register from bills",
      "Distributor e-bill import with PTR, PTS, free quantity and schemes",
      "Expiry claims to distributors tracked until the credit note arrives",
    ],
    medoroCons: [
      "Costs more than a general billing app (from ₹999 a month)",
      "Made for pharmacies only: not suited to running other kinds of shops",
      "There is no free-forever plan, only a 7-day free trial",
    ],
    exportTip: "In Vyapar, export your items with stock, parties and reports to Excel from the app's export options. Medoro imports the Excel files and checks each row.",
    faq: [
      ["Is Vyapar good for a medical store?", "Vyapar handles GST billing and basic stock well for many small shops. Medical stores that need batch-wise expiry control, prescription medicines, distributor e-bills and returns usually find pharmacy-specific software saves more time."],
      ["Can I import my Vyapar data into Medoro?", "Yes. Export items, stock, suppliers and customers to Excel from Vyapar and import them into Medoro. Rows with problems are listed with the reason, so you can fix them before importing."],
      ["Does Medoro have a mobile app like Vyapar?", "Medoro installs as an app on Android and works in any phone browser. Owners get a phone-sized view with today's sales, cash, low stock and expiring batches."],
      ["Can I try Medoro before switching?", "Yes. There is a 7-day free trial with every feature and no card needed."],
    ],
  },
  {
    slug: "redbook-alternative",
    competitor: "RedBook",
    name: "Medoro vs RedBook",
    title: "RedBook Alternative for Pharmacy Billing: Medoro",
    description: "Considering a RedBook alternative for your pharmacy? Compare cloud access, backups, distributor bill import, expiry alerts, H1 register and pricing with Medoro.",
    keywords: ["redbook alternative", "redbook pharmacy software alternative", "medoro vs redbook", "redbook billing software alternative"],
    h1: "Thinking of moving off RedBook?",
    intro: "Many chemists run their counters on long-established desktop billing packages such as RedBook. If you are weighing a move to a cloud system, this page sets out what Medoro does and the questions to ask about your current setup, so you can compare like for like.",
    verdict: "If your current software does everything you need and your staff are happy with it, switching has a real cost. Medoro is worth a trial if you want to bill from more than one device, check the shop from your phone, stop worrying about backups, or cut the time spent typing distributor bills and chasing expiry.",
    them: {
      cloud: ask("Ask whether you can bill and see reports from any device without remote-desktop tools"),
      noServer: ask("Ask who maintains the PC or server and how backups are taken and tested"),
      billImport: ask("Ask which distributor e-bill formats can be imported and how items are matched"),
      mobile: ask("Ask whether there is a mobile app and what it can do"),
      expiry: ask("Ask whether near-expiry lists show the projected loss and supplier return windows"),
      h1: ask("Ask whether the Schedule H1 register is built from bills automatically"),
      hindi: ask("Ask the vendor about Hindi screens"),
      pricing: ask("Ask for the full cost: licence, renewals, updates and support"),
    },
    theirPros: [
      "Your staff already know it, so there is nothing new to learn",
      "Existing bills, reports and history are where you expect them",
      "A local installation keeps working without internet",
    ],
    theirCons: [
      "Check how you would use it from home or from a second branch",
      "Check who is responsible if the shop PC fails, and when a backup was last restored",
      "Check how long distributor bills take to enter each week",
    ],
    medoroPros: [
      "Bill from any counter, tablet or phone; see sales and dues on your phone",
      "Encrypted daily backups to your own Google Drive, with test restores",
      "Distributor e-bill import and printed-bill scanning",
      "Expiry list with projected loss, return suggestions and claims tracking",
      "Published prices and a 7-day free trial",
    ],
    medoroCons: [
      "Your team has to learn a new screen (keyboard-first, so most staff are billing within a day)",
      "Old bills stay in your current software for reference; Medoro imports masters and stock, not past bills",
      "Newer, with support on WhatsApp and email rather than local dealers",
    ],
    exportTip: "Export the item master with batch-wise stock, suppliers and customers to Excel or CSV from your current software. If it can't export, send us a sample report on WhatsApp and we'll tell you the quickest route.",
    faq: [
      ["Can I move from RedBook to Medoro?", "If your current software can export items, batch-wise stock, suppliers and customers to Excel or CSV, Medoro can import them with row-by-row checks. Send us a sample export on WhatsApp if you're unsure."],
      ["Will I lose my old bills?", "Medoro imports masters and opening stock, not past bills. Keep your old software or its reports for reference for as long as you need them."],
      ["How long does switching take?", "Most pharmacies export in the morning, import and check in the afternoon, set up printers and staff in the evening, and bill on Medoro the next day."],
      ["Why does this page say 'ask the vendor'?", "We couldn't verify RedBook's current features from public information, so instead of guessing we've listed the questions that matter. If you use RedBook and something here is out of date, tell us at hello@medoro.in."],
    ],
  },
  {
    slug: "logic-erp-alternative",
    competitor: "Logic ERP",
    name: "Medoro vs Logic ERP",
    title: "Logic ERP Alternative for Pharmacy: Medoro vs Logic",
    description: "Logic ERP vs Medoro for pharmacies: compare cloud access, server upkeep, distributor bill import, mobile access, expiry alerts, Schedule H1 register and pricing.",
    keywords: ["logic erp alternative", "logic erp pharmacy alternative", "medoro vs logic erp", "logic pharmacy software alternative"],
    h1: "A simpler Logic ERP alternative for pharmacies",
    intro: "Logic ERP is a retail and distribution ERP used across several industries, including pharma retail and wholesale. Medoro focuses only on medical stores and small pharmacy chains. Here's how the two compare for a retail pharmacy.",
    verdict: "Logic ERP suits larger businesses that need one ERP across retail, wholesale and other verticals, with implementation by the vendor's team. Medoro suits retail pharmacies and chains of up to five branches that want to be live within a day and don't want to run servers.",
    them: {
      cloud: { v: "partial", note: "Typically installed on your own PCs or server; ask about hosted options" },
      noServer: { v: "partial", note: "On-premise installs need a PC or server you maintain; depends on deployment" },
      billImport: ask("Ask which distributor e-bill formats are supported"),
      mobile: { v: "partial", note: "Mobile apps are offered for some functions; ask which ones" },
      expiry: { v: "partial", note: "Batch and expiry tracking with reports" },
      h1: ask("Ask how Schedule H1 entries are captured and reported"),
      hindi: ask("Ask the vendor about Hindi screens"),
      pricing: { v: "no", note: "Quoted per business; not published as a price list" },
    },
    theirPros: [
      "Broad ERP that covers retail, wholesale and distribution",
      "Configurable for large and complex businesses",
      "Implementation and training by the vendor's team",
    ],
    theirCons: [
      "More setup and configuration than a small pharmacy usually needs",
      "Servers or PCs and their backups are usually yours to maintain",
      "Pricing is by quote, which makes comparing total cost harder",
    ],
    medoroPros: [
      "Built only for pharmacies, so the screens match how a chemist works",
      "Live in a day: import, check, set up counters, bill tomorrow",
      "No server to run on the hosted plan; backups to your own Google Drive",
      "Prices on the website, from ₹999 a month, and a 7-day free trial",
    ],
    medoroCons: [
      "Not an ERP for distribution, wholesale or other industries",
      "Up to 5 branches on the Multi-branch plan, with extra branches as an add-on",
      "Fewer customisation options than a configurable ERP",
    ],
    exportTip: "Export the item master, batch-wise stock, suppliers and customers from Logic ERP to Excel (or ask your implementation contact). Medoro imports and checks the files.",
    faq: [
      ["Can I switch from Logic ERP to Medoro?", "Yes. Export items with batch-wise stock, suppliers and customers to Excel or CSV and import them into Medoro. Rows are checked one by one and nothing is saved until the whole file passes."],
      ["Does Medoro handle multiple branches like Logic ERP?", "Yes, up to 5 branches on the Multi-branch plan (more with an add-on), with approved stock transfers, central buying and consolidated reports."],
      ["Is Medoro suitable for a pharma distributor?", "No. Medoro is built for retail pharmacies and small chains. Distributors are better served by a distribution ERP."],
      ["How much does Medoro cost?", "₹999 a month for Starter, ₹2,499 for Professional and ₹4,499 for Multi-branch, GST included. Yearly plans are billed as 10 months."],
    ],
  },
];

export const comparisonBySlug = (slug: string) => COMPARISONS.find((c) => c.slug === slug);
