/**
 * Solution pages (/solutions/[niche]) for each kind of pharmacy business. Same rule as the feature pages: only what
 * the product does today. Plan limits follow src/lib/plans.ts.
 */
import type { ToolSlug } from "./tools";

export type Solution = {
  slug: string;
  name: string;
  title: string;
  description: string;
  keywords: string[];
  eyebrow: string;
  h1: string;
  intro: string;
  /** The plan that usually fits, and why. */
  plan: [name: string, why: string];
  /** The day of this business, in a few lines. */
  dayInLife: { time: string; task: string; how: string }[];
  outcomes: { h: string; p: string }[];
  features: string[];
  tools: ToolSlug[];
  faq: [q: string, a: string][];
};

export const SOLUTIONS: Solution[] = [
  {
    slug: "retail-pharmacy",
    name: "Retail pharmacy & chemist shop",
    title: "Software for Retail Pharmacy & Chemist Shops in India",
    description: "Pharmacy software for single medical stores: fast GST billing, batch and expiry control, distributor purchases, customer credit and WhatsApp bills. From ₹999/month.",
    keywords: ["retail pharmacy software", "chemist shop software", "medical shop billing software", "single store pharmacy software"],
    eyebrow: "For retail pharmacies",
    h1: "Everything a single medical store needs, nothing it doesn't.",
    intro: "Most chemist shops run on one or two counters, a godown and the owner's memory. Medoro takes the counter, the stock and the books off your mind, so you can spend the day with customers instead of registers.",
    plan: ["Starter or Professional", "Starter (₹999/month) covers billing, stock, purchases and WhatsApp bills for 2 counters. Professional adds accounts, customer credit, the invoice scanner and offline billing."],
    dayInLife: [
      { time: "9:00 am", task: "Open the shop", how: "The dashboard shows yesterday's sales, today's expiring batches and low stock." },
      { time: "11:30 am", task: "Distributor's bill arrives", how: "Import the e-bill; batches, expiry, PTR and free quantity land in stock once the total matches." },
      { time: "6:00 pm", task: "Evening rush", how: "Bill in three keys with the earliest-expiring batch picked; send bills on WhatsApp." },
      { time: "9:30 pm", task: "Close the shift", how: "Cash difference is posted, and the day's numbers are on your phone." },
    ],
    outcomes: [
      { h: "Shorter queues", p: "Brand, salt and barcode search with FEFO batches and held carts keeps the counter moving." },
      { h: "Less expiry loss", p: "A 90-day list with the rupee loss at stake, early enough to return stock to the distributor." },
      { h: "Dues under control", p: "Customer credit with limits and supplier dues with due dates, both visible on your phone." },
    ],
    features: ["gst-billing", "expiry-management", "inventory-management", "ai-invoice-scanner"],
    tools: ["pharma-margin-calculator", "free-pharmacy-invoice-generator"],
    faq: [
      ["Is Medoro too complex for a small chemist shop?", "No. The counter screen is three keys: F2 to search, Enter to add, F9 to complete. Most staff are billing on their own within the first day."],
      ["What do I need to run it?", "A PC, laptop or tablet with Chrome, or the desktop app for Windows, macOS or Linux. A USB barcode scanner and 80 mm thermal printer are optional but recommended."],
      ["How much does it cost?", "Starter is ₹999 a month for one store, and Professional is ₹2,499. Both include GST, and there's a 7-day free trial with every feature."],
    ],
  },
  {
    slug: "pharmacy-chains",
    name: "Pharmacy chains & multi-branch",
    title: "Pharmacy Chain Software: Multi-Branch Billing & Stock",
    description: "Multi-branch pharmacy software: one view of every branch, approved stock transfers, central buying, consolidated reports and owner's phone view. Up to 5 branches.",
    keywords: ["pharmacy chain software", "multi branch pharmacy software", "pharmacy chain management system", "multi store medical software"],
    eyebrow: "For pharmacy chains",
    h1: "Run every branch like you're standing in it.",
    intro: "When a pharmacy grows to three, four or five branches, the owner can't be at every counter. Medoro gives you one live view of sales, cash, stock and expiry across branches, with transfers and central buying so stock sits where it sells.",
    plan: ["Multi-branch", "Up to 5 branches, 15 counters and 25 users (₹4,499/month), with extra branches as an add-on. Includes transfers, central purchasing, consolidated reports and anomaly review."],
    dayInLife: [
      { time: "8:30 am", task: "Owner's check from home", how: "Today vs yesterday by branch, cash in each drawer, approvals waiting, all on the phone." },
      { time: "12:00 pm", task: "Weekly buying", how: "Central buying shows each branch's needs per supplier and drafts POs for every branch in one go." },
      { time: "3:00 pm", task: "Rebalance stock", how: "Move slow batches to the branch that sells them before they expire, with approval on both ends." },
      { time: "Night", task: "Report email", how: "Daily sales, GST, low stock, expiring and dues for every branch arrive in your inbox." },
    ],
    outcomes: [
      { h: "One set of numbers", p: "Branch and consolidated reports, with margins on landed cost by item, category and supplier." },
      { h: "Stock where it sells", p: "Approved transfers batch by batch, and expiry suggestions that point to the branch that will sell it in time." },
      { h: "Control without micromanaging", p: "Roles and permissions per user, discount caps, an audit trail and anomaly review for owners." },
    ],
    features: ["inventory-management", "expiry-management", "gst-billing", "ai-invoice-scanner"],
    tools: ["pharma-margin-calculator", "medicine-hsn-code-finder"],
    faq: [
      ["How many branches can Medoro handle?", "The Multi-branch plan covers up to 5 branches, 15 counters and 25 users. Extra branches can be added as an add-on."],
      ["Do branches with different GSTINs work?", "Yes. GST returns are prepared per GSTIN and month, with a GSTIN- and branch-wise roll-up, and branch transfers can carry e-way bills when e-invoicing is switched on."],
      ["Can I restrict what branch staff can see?", "Yes. Roles control what each person can do, with per-user overrides, and customer phone numbers can be masked below manager level."],
    ],
  },
  {
    slug: "hospital-pharmacy",
    name: "Hospital & clinic pharmacy",
    title: "Hospital Pharmacy Software for Clinics & Nursing Homes",
    description: "Pharmacy software for hospital and clinic pharmacies: prescriber on every bill, Schedule H1 register, B2B tax invoices, credit accounts and sales by doctor reports.",
    keywords: ["hospital pharmacy software", "clinic pharmacy software", "nursing home pharmacy billing", "in-house pharmacy software india"],
    eyebrow: "For hospital & clinic pharmacies",
    h1: "A pharmacy counter that keeps up with the OPD.",
    intro: "Pharmacies inside or next to a hospital, clinic or nursing home see long prescriptions, many prescription-only medicines and a mix of walk-in, credit and institutional sales. Medoro handles all three at one counter.",
    plan: ["Professional", "Adds customer credit and statements, accounts and offline billing on up to 5 counters (₹2,499/month). Chains of hospital pharmacies move to Multi-branch."],
    dayInLife: [
      { time: "10:00 am", task: "OPD rush", how: "Long prescriptions billed with salt and brand search; the doctor is picked from the list once per bill." },
      { time: "1:00 pm", task: "Ward and institutional supply", how: "B2B tax invoices with the buyer's GSTIN, on credit with a limit and a running statement." },
      { time: "5:00 pm", task: "Inspection-ready", how: "The Schedule H1 register for any date range, printed or as CSV." },
      { time: "Month-end", task: "Doctor-wise review", how: "Sales by doctor for any period and branch, on screen or as CSV." },
    ],
    outcomes: [
      { h: "Prescription records kept", p: "Prescriber captured on every Schedule H and H1 sale, and the H1 register built from bills." },
      { h: "Credit that's tracked", p: "Credit limits per customer or institution, ledger statements for any period and collections." },
      { h: "Short-dated stock handled", p: "Expensive, slow-moving injectables are flagged early with the loss at stake and the supplier's return window." },
    ],
    features: ["schedule-h1-compliance", "gst-billing", "expiry-management", "inventory-management"],
    tools: ["free-pharmacy-invoice-generator", "medicine-hsn-code-finder"],
    faq: [
      ["Does Medoro integrate with our hospital management system (HMS)?", "Not directly today. Medoro runs the pharmacy (billing, stock, GST and accounts) on its own. Doctors can be kept in Medoro's doctor master with registration numbers, and reports export as CSV."],
      ["Can we bill patients on credit and settle on discharge?", "Yes. Customer credit with limits keeps a running balance, and you can take payments against it and print a statement for any period."],
      ["Can we see which doctor's prescriptions we fill?", "Yes. The prescriber is linked to the doctor master, and the sales-by-doctor report shows totals for any period and branch."],
    ],
  },
  {
    slug: "ayurvedic-stores",
    name: "Ayurvedic & AYUSH stores",
    title: "Ayurvedic Store Billing Software with GST & Stock",
    description: "Billing and stock software for Ayurvedic, homoeopathic and AYUSH stores: batch and expiry, correct HSN and GST, loose sale, WhatsApp bills and Hindi screens.",
    keywords: ["ayurvedic store billing software", "ayurvedic medical store software", "homeopathic pharmacy software", "ayush store software"],
    eyebrow: "For Ayurvedic & AYUSH stores",
    h1: "Billing and stock for Ayurvedic and homoeopathic stores.",
    intro: "Ayurvedic, Unani, Siddha and homoeopathic stores carry hundreds of small SKUs from many manufacturers, often alongside allopathic medicines and personal care. Medoro keeps each one's HSN, GST, batch and expiry straight.",
    plan: ["Starter", "Billing, batch stock, purchases and WhatsApp bills for 1 store and 2 counters (₹999/month). Add Professional for accounts and customer credit."],
    dayInLife: [
      { time: "Morning", task: "Receive stock", how: "Import the distributor's bill or enter it with batch, expiry and MRP for each item." },
      { time: "Afternoon", task: "Counter sales", how: "Search by product or ingredient, sell by bottle or loose by unit, and print or WhatsApp the bill." },
      { time: "Evening", task: "Reorder", how: "Low-stock list from sales, with draft purchase orders by manufacturer or distributor." },
    ],
    outcomes: [
      { h: "Right HSN and GST", p: "HSN per item (3004 90 11 for Ayurvedic, 3004 90 14 for homoeopathic) and GST worked out from MRP on every line." },
      { h: "Expiry on small SKUs", p: "Batch-wise expiry for every bottle and pack, so slow lines don't quietly go past date." },
      { h: "Repeat customers", p: "Refill reminders and offers on WhatsApp for regular customers who have opted in." },
    ],
    features: ["gst-billing", "expiry-management", "inventory-management"],
    tools: ["medicine-hsn-code-finder", "free-pharmacy-invoice-generator"],
    faq: [
      ["What GST rate applies to Ayurvedic medicines?", "Ayurvedic, Unani, Siddha and homoeopathic medicines are taxed at 5% since 22 September 2025 (12% before). Personal care items such as soap, hair oil and toothpaste moved from 18% to 5%. Use the HSN code finder for specific items."],
      ["Can I sell allopathic and Ayurvedic products in the same bill?", "Yes. Each item carries its own HSN and GST rate, and the bill shows the tax by slab."],
      ["Can my staff use it in Hindi?", "Yes. Every screen is available in English and हिंदी, switchable per person."],
    ],
  },
];

export const solutionBySlug = (slug: string) => SOLUTIONS.find((s) => s.slug === slug);
