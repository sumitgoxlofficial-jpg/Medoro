/**
 * Feature landing pages (/features/[slug]). Every claim here is something the product does today (see README.md
 * "What works now" and docs/PURCHASING.md): keep it that way when editing. Plan names follow src/lib/plans.ts.
 *
 * Adding a page: add an entry here and its [name, slug] to FEATURE_LINKS in src/data/site-links.ts
 * (src/data/seo-data.test.ts keeps the two in step). The route, sitemap and footer pick it up.
 */
import type { ToolSlug } from "./tools";

export type MockupTone = "ok" | "warn" | "bad" | "info" | undefined;
export type MockupRow = { cells: string[]; tone?: MockupTone; note?: string };
export type MockupView = { tab: string; caption: string; columns: string[]; rows: MockupRow[]; footer?: [label: string, value: string][] };

export type FeaturePage = {
  slug: string;
  /** Short name for links, breadcrumbs and the footer. */
  name: string;
  /** <title> without the "| Medoro" suffix; the search phrase first. */
  title: string;
  description: string;
  keywords: string[];
  eyebrow: string;
  h1: string;
  intro: string;
  /** Lowest plan that includes the whole feature. */
  plan: "Starter" | "Professional" | "Multi-branch";
  /** The day-to-day problem and how Medoro handles it. */
  problems: { pain: string; fix: string }[];
  /** A screen-like preview of the feature, drawn with real-looking data. */
  mockup: { window: string; views: MockupView[] };
  highlights: { h: string; p: string; points: string[] }[];
  faq: [q: string, a: string][];
  tools: ToolSlug[];
  related: string[];
};

export const FEATURES: FeaturePage[] = [
  {
    slug: "gst-billing",
    name: "GST billing & counter POS",
    title: "Pharmacy GST Billing Software & Fast Counter POS",
    description: "Pharmacy GST billing in three keys: salt and barcode search, FEFO batch picking, CGST/SGST/IGST split from MRP, thermal and A4 bills, WhatsApp invoices.",
    keywords: ["pharmacy gst billing software", "medical store billing software", "chemist billing software", "pharmacy pos software india", "gst invoice for medical store"],
    eyebrow: "Pharmacy GST billing & fast counter POS",
    h1: "GST-correct chemist bills in three keystrokes.",
    intro: "Search by brand, salt or barcode with F2, press Enter to add, F9 to complete the sale. Medoro picks the earliest-expiring batch, works out the taxable value and CGST/SGST (or IGST) from the MRP on every line, and prints on your 80 mm thermal printer or sends a PDF on WhatsApp.",
    plan: "Starter",
    problems: [
      { pain: "Queues build up while staff hunt for a brand or scroll through batches.", fix: "Brand, salt, squashed-brand (\"dolo650\") and typo-tolerant search, with the FEFO batch already selected. F6 shows substitutes with the same salt that are in stock." },
      { pain: "GST is worked out from MRP by hand or in Excel at month-end.", fix: "Every line carries its taxable value back-calculated from the MRP-inclusive price, split into CGST and SGST, or IGST for out-of-state buyers. GSTR-1 and GSTR-3B are built from these lines." },
      { pain: "Customers want 4 tablets from a strip of 15 and the stock goes wrong.", fix: "Loose sale with pack definitions: sell by strip or tablet (F7). Stock is kept in the smallest unit and a loose tablet is priced at MRP ÷ pack, rounded down so it never exceeds MRP." },
      { pain: "Paper bills get lost and customers ask for duplicates.", fix: "Bills print on thermal or A4 and can go to the customer as a PDF on WhatsApp with delivered and read status." },
      { pain: "Expired or recalled batches still get billed by mistake.", fix: "Expired, quarantined and recalled batches are blocked on the server, even if someone selects them by hand." },
    ],
    mockup: {
      window: "Billing · Counter 1",
      views: [
        {
          tab: "Cart", caption: "A three-line sale with the earliest-expiring batch picked on each line.",
          columns: ["Item", "Batch", "Exp", "Qty", "MRP", "GST", "Amount"],
          rows: [
            { cells: ["Dolo 650 Tablet 15's", "DOBS3021", "08/27", "2", "₹33.60", "5%", "₹67.20"], tone: "ok", note: "FEFO" },
            { cells: ["Pan-D Capsule 15's", "PDK24117", "03/27", "1", "₹199.00", "5%", "₹199.00"], tone: "ok", note: "FEFO" },
            { cells: ["Azithral 500 Tablet 3's", "AZE5102", "11/26", "1", "₹119.50", "5%", "₹119.50"], tone: "warn", note: "Rx · prescriber added" },
          ],
          footer: [["Items", "3"], ["Net payable", "₹385.70"], ["Rounded", "₹386.00"]],
        },
        {
          tab: "GST split", caption: "Taxable value and tax back-calculated from MRP for the same bill.",
          columns: ["Slab", "HSN", "Taxable", "CGST", "SGST", "Total"],
          rows: [
            { cells: ["5%", "3004", "₹367.33", "₹9.18", "₹9.19", "₹385.70"] },
            { cells: ["Round-off", "", "", "", "", "₹0.30"], tone: "info" },
          ],
          footer: [["Invoice", "INV/26-27/0418"], ["Place of supply", "Jharkhand (20)"]],
        },
        {
          tab: "Payment", caption: "Split tender on one bill, with the customer's credit limit checked.",
          columns: ["Mode", "Reference", "Amount", "Status"],
          rows: [
            { cells: ["UPI", "UTR 6148…2207", "₹300.00", "Received"], tone: "ok" },
            { cells: ["Cash", "Drawer 1", "₹86.00", "Received"], tone: "ok" },
            { cells: ["WhatsApp invoice", "+91 98•••••210", "PDF", "Delivered"], tone: "info" },
          ],
          footer: [["Paid", "₹386.00"], ["Change", "₹0.00"]],
        },
      ],
    },
    highlights: [
      { h: "Keyboard-first counter", p: "Built for a busy chemist counter: no mouse needed from search to printed bill.", points: ["F2 search, Enter add, F9 complete", "Held carts for the next customer", "Returns and credit notes against the invoice"] },
      { h: "GST done on every line", p: "MRP-inclusive pricing with the tax worked out per line at each item's own rate and HSN.", points: ["CGST/SGST, or IGST for other states", "B2B tax invoices with the buyer's GSTIN", "E-invoice IRN and QR where your turnover requires it"] },
      { h: "Every way to pay", p: "Cash, UPI, card, split payments and customer credit with limits, plus loyalty points as a tender.", points: ["Credit limits per customer", "Discount caps by role", "Shift close with cash difference"] },
    ],
    faq: [
      ["How does Medoro calculate GST on a medicine sold at MRP?", "MRP includes GST. Medoro back-calculates the taxable value as MRP × 100 ÷ (100 + GST rate) on each line, then splits the tax into CGST and SGST for sales inside your state, or IGST for out-of-state buyers. Amounts are kept in paise, so the totals match your GSTR-1 to the paisa."],
      ["Can I sell loose tablets from a strip?", "Yes. Set the pack once (for example 1 strip = 15 tablets) and the cashier picks strip or tablet with F7. A loose tablet is priced at MRP ÷ 15 rounded down to the paisa, and stock is reduced in tablets."],
      ["Does it work with my barcode scanner and thermal printer?", "Yes. USB barcode scanners and 80 mm thermal printers work out of the box, and A4 invoices print from any printer. Items without a barcode can get an in-store EAN-13 label that scans at the counter."],
      ["Can I make B2B bills for clinics and hospitals?", "Yes. Add the buyer's GSTIN and the bill becomes a tax invoice with place of supply; out-of-state buyers are charged IGST. E-invoicing can be switched on for businesses that need IRNs."],
      ["Which plan includes billing?", "Billing is in every plan, starting with Starter at ₹999 a month for one store (2 counters, 3 users). The 7-day free trial includes every feature."],
    ],
    tools: ["free-pharmacy-invoice-generator", "medicine-hsn-code-finder", "pharma-margin-calculator"],
    related: ["expiry-management", "schedule-h1-compliance", "inventory-management"],
  },
  {
    slug: "expiry-management",
    name: "Batch & expiry management",
    title: "Pharmacy Expiry Management & Batch Tracking Software",
    description: "Track every medicine batch with expiry, see 30/60/90/180-day near-expiry lists with projected loss, return to distributors in time and block expired sales.",
    keywords: ["pharmacy expiry management software", "near expiry medicine alert", "batch tracking pharmacy", "medicine expiry tracker", "fefo pharmacy software"],
    eyebrow: "Batch tracking & near-expiry alerts",
    h1: "See expiring stock while you can still return it.",
    intro: "Medoro tracks every batch in your pharmacy with its expiry, rack and landed cost. It lists what will not sell before it expires, puts a rupee value on the loss, and suggests whether to return it to the distributor, move it to another branch or offer it to regular customers, inside each supplier's return window.",
    plan: "Starter",
    problems: [
      { pain: "Expired strips are found on the shelf during the yearly clean-out, long after the return window closed.", fix: "30, 60, 90 and 180-day windows list every batch with days left, units that won't sell in time at your current sales rate, and the projected loss at cost." },
      { pain: "Staff sell from the newest box and older batches expire behind it.", fix: "FEFO (first expiry, first out) picks the earliest-expiring sellable batch on every bill automatically." },
      { pain: "Expiry claims to distributors are tracked in a notebook and credit notes never arrive.", fix: "Expiry, near-expiry and breakage claims move stock out at once and track raised → acknowledged → credit note received, with part credits and claim aging per supplier." },
      { pain: "A drug recall means checking every shelf in every branch.", fix: "A recall notice quarantines matching batches across all branches at once and they can no longer be billed." },
    ],
    mockup: {
      window: "Stock · Expiry",
      views: [
        {
          tab: "Next 90 days", caption: "Batches expiring within 90 days, with what won't sell in time.",
          columns: ["Medicine", "Batch", "Expiry", "Days left", "Stock", "Won't sell", "Loss at cost"],
          rows: [
            { cells: ["Augmentin 625 Duo 10's", "AG2304K", "31/12/26", "46", "38", "22", "₹3,960"], tone: "bad", note: "Return to supplier" },
            { cells: ["Montair LC Tablet 15's", "MLC9921", "31/01/27", "77", "24", "9", "₹1,476"], tone: "warn", note: "Move to Branch 2" },
            { cells: ["Shelcal 500 Tablet 15's", "SH77812", "28/02/27", "105", "60", "0", "₹0"], tone: "ok", note: "Sells in time" },
          ],
          footer: [["Batches in window", "27"], ["Projected loss", "₹18,420"]],
        },
        {
          tab: "Claims", caption: "Expiry claims to distributors and where each one stands.",
          columns: ["Supplier", "Claim", "Reason", "Claimed", "Status"],
          rows: [
            { cells: ["Shree Balaji Pharma", "CLM-0041", "Near expiry", "₹6,212", "Credit note received"], tone: "ok" },
            { cells: ["Medplus Distributors", "CLM-0044", "Expired", "₹2,480", "Acknowledged"], tone: "info" },
            { cells: ["Om Sai Agencies", "CLM-0047", "Breakage", "₹640", "Raised · 12 days"], tone: "warn" },
          ],
          footer: [["Open claims", "₹9,332"]],
        },
      ],
    },
    highlights: [
      { h: "Batch-level stock", p: "Every receipt creates a batch with expiry, MRP, landed cost and rack.", points: ["Batch, expiry and MRP on every bill", "Quarantine and release", "Movement ledger per batch"] },
      { h: "Loss you can act on", p: "The list is ordered by money at risk, not just by date, so the biggest losses get handled first.", points: ["Sales-velocity based projection", "Return, transfer or push suggestions", "Supplier return windows respected"] },
      { h: "Claims that close", p: "Debit notes for returns, and claims that track the distributor's credit note even when it arrives weeks later for less.", points: ["Partial credits", "Shortfall written off with a reason", "Aging per supplier"] },
    ],
    faq: [
      ["How early does Medoro warn about expiring medicines?", "You choose the window: 30, 60, 90 or 180 days. Most pharmacies work from the 90-day list because many distributors accept near-expiry returns only within a fixed window before expiry. You can set each supplier's return window in Medoro."],
      ["Can expired medicine still be billed by mistake?", "No. Billing picks the earliest-expiring sellable batch automatically, and expired, quarantined or recalled batches are refused on the server even if someone selects them by hand."],
      ["How is the projected loss calculated?", "Medoro compares the units in each batch with how fast that medicine has been selling, estimates how many units will still be on the shelf at expiry, and values them at the batch's landed cost."],
      ["Does it track expiry claims with distributors?", "Yes. Raise a claim for expired, near-expiry, broken or wrong items; the stock leaves at once and the claim is tracked until the credit note is received or the claim is rejected."],
    ],
    tools: ["pharma-margin-calculator", "medicine-hsn-code-finder"],
    related: ["inventory-management", "gst-billing", "ai-invoice-scanner"],
  },
  {
    slug: "inventory-management",
    name: "Inventory & reorder management",
    title: "Pharmacy Inventory Software: Stock, Reorder & Racks",
    description: "Pharmacy inventory software with batch-wise stock, rack locations, reorder forecasts from sales, draft purchase orders, stock counts, barcode labels and transfers.",
    keywords: ["pharmacy inventory management software", "medical store stock management", "pharmacy reorder software", "rack management pharmacy", "medicine stock software"],
    eyebrow: "Automated stock, reorder & rack management",
    h1: "Know what's on the rack, and what to order next.",
    intro: "Medoro keeps stock per batch and per rack, learns how fast each medicine sells, and turns that into a reorder list and draft purchase orders. Stock counts, adjustments and branch transfers are logged with who did what and when.",
    plan: "Starter",
    problems: [
      { pain: "Fast movers run out on Saturday evening; slow movers pile up in the godown.", fix: "Reorder levels per item plus a forecast from recent sales give a low-stock list and draft purchase orders grouped by supplier." },
      { pain: "Nobody knows which rack a medicine is on, so new staff take ages.", fix: "Every medicine has a rack (with a per-branch override). It shows in counter search and on printable count sheets in shelf order." },
      { pain: "Physical stock and the system never match, and nobody knows why.", fix: "Stock counts by rack with variance, and every adjustment needs a reason and is kept in an audit trail." },
      { pain: "Margins are guessed because free goods and schemes are not counted.", fix: "Landed cost per unit spreads free quantity, scheme and trade discounts, so margin by item, category and supplier is real." },
    ],
    mockup: {
      window: "Stock · Reorder",
      views: [
        {
          tab: "Reorder list", caption: "Items below their reorder level, with suggested quantities from sales.",
          columns: ["Medicine", "Rack", "In stock", "Sold / 28 days", "Reorder at", "Suggest", "Supplier"],
          rows: [
            { cells: ["Telma 40 Tablet 15's", "B-04", "6", "54", "20", "60", "Shree Balaji Pharma"], tone: "bad" },
            { cells: ["Glycomet GP 1 Tablet 15's", "B-11", "14", "48", "18", "45", "Medplus Distributors"], tone: "warn" },
            { cells: ["Ecosprin 75 Tablet 14's", "A-02", "22", "40", "15", "30", "Medplus Distributors"], tone: "ok" },
          ],
          footer: [["Draft POs", "2 suppliers"], ["Estimated value", "₹14,860"]],
        },
        {
          tab: "Stock count", caption: "A rack-wise count with variance before it is posted.",
          columns: ["Rack", "Medicine", "Batch", "System", "Counted", "Variance"],
          rows: [
            { cells: ["C-07", "Cetzine 10mg Tablet 10's", "CTZ1182", "40", "40", "0"], tone: "ok" },
            { cells: ["C-07", "Allegra 120mg Tablet 10's", "ALG4410", "18", "16", "−2"], tone: "bad" },
            { cells: ["C-08", "Sinarest Tablet 10's", "SNR0973", "25", "25", "0"], tone: "ok" },
          ],
          footer: [["Lines counted", "126"], ["Net variance", "−₹412"]],
        },
      ],
    },
    highlights: [
      { h: "Reorder from real sales", p: "Forecasts from the last weeks of sales, a seasonal planner after a year of data, and draft POs you review before sending.", points: ["Reorder levels per item", "Draft POs grouped by supplier", "Central buying across branches (Multi-branch)"] },
      { h: "Racks and counts", p: "Rack locations in search and on count sheets, so counting and picking go shelf by shelf.", points: ["Count sheets in shelf order", "Variance before posting", "Adjustments with reasons"] },
      { h: "Labels and loose units", p: "Print barcode labels with batch, expiry, MRP and rack, and hold stock in strips and tablets.", points: ["Code 128 and EAN-13 labels", "50×25 mm or A4 sheets", "Packs plus loose remainder"] },
    ],
    faq: [
      ["How does Medoro decide what to reorder?", "Each medicine can have a reorder level. Medoro compares stock in hand with that level and with recent sales, and suggests a quantity. The assistant can turn the list into draft purchase orders grouped by supplier for you to review."],
      ["Can I track rack or shelf locations?", "Yes. Each medicine has a rack, which a branch can override. The rack shows in counter search, and count sheets can be filtered by rack and printed in shelf order."],
      ["Can I transfer stock between branches?", "Yes, on the Multi-branch plan. Transfers are requested, approved and received, and stock moves batch by batch so expiry stays correct."],
      ["Can I bring in my current stock?", "Yes. Import medicines with opening stock, batches and expiry from Excel or CSV. Every row is checked for expiry, GST rate and MRP against cost before anything is saved."],
    ],
    tools: ["pharma-margin-calculator", "medicine-hsn-code-finder"],
    related: ["expiry-management", "ai-invoice-scanner", "gst-billing"],
  },
  {
    slug: "schedule-h1-compliance",
    name: "Schedule H & H1 drug register",
    title: "Schedule H1 Register Software for Pharmacies",
    description: "Capture the prescriber on every Schedule H, H1 and X sale and keep a Schedule H1 register with patient, prescriber, drug and quantity, ready to show or export.",
    keywords: ["schedule h1 register software", "schedule h1 drug register", "schedule h drug register pharmacy", "narcotic drug register pharmacy", "prescription register software"],
    eyebrow: "Automated Schedule H & H1 drug register",
    h1: "Your Schedule H1 register, written as you bill.",
    intro: "When a medicine needs a prescription, Medoro asks for the prescriber before the bill closes and keeps the patient and prescriber with the sale. The Schedule H1 register (H1, X and NDPS sales with patient, prescriber, drug and quantity) builds itself from those bills, on screen or as CSV.",
    plan: "Starter",
    problems: [
      { pain: "The H1 register is a handwritten book that falls behind on busy days.", fix: "Every H1, X and NDPS sale goes into the register automatically with date, invoice, patient, prescriber, drug, batch and quantity." },
      { pain: "Staff forget to note the doctor for prescription-only medicines.", fix: "Schedule H and H1 items ask for the prescriber before the bill can be completed. A doctor list with registration numbers makes it a two-key entry." },
      { pain: "An inspector asks for records from months ago.", fix: "Filter the register by any date range and print or export it in seconds. Bills are append-only, so records cannot be quietly edited." },
    ],
    mockup: {
      window: "Reports · Schedule H1 register",
      views: [
        {
          tab: "Register", caption: "Schedule H1, X and NDPS sales with patient and prescriber.",
          columns: ["Date", "Invoice", "Patient", "Prescriber (Reg. no.)", "Drug", "Batch", "Qty"],
          rows: [
            { cells: ["14/11/26", "INV/0412", "Ramesh Kumar", "Dr. A. Sinha (JMC 4412)", "Zifi 200 Tablet 10's", "ZF2231", "10"], tone: "info", note: "H1" },
            { cells: ["14/11/26", "INV/0415", "Sunita Devi", "Dr. P. Mahato (JMC 2097)", "Tramadol 50 Capsule 10's", "TRM881", "10"], tone: "warn", note: "H1" },
            { cells: ["15/11/26", "INV/0418", "Arjun Singh", "Dr. A. Sinha (JMC 4412)", "Azithral 500 Tablet 3's", "AZE5102", "3"], tone: "info", note: "H" },
          ],
          footer: [["Entries this month", "84"], ["Export", "CSV · Print"]],
        },
        {
          tab: "At the counter", caption: "What the cashier sees when a prescription medicine is added.",
          columns: ["Step", "What happens"],
          rows: [
            { cells: ["Add Zifi 200 (Schedule H1)", "Prescriber required before the bill can close"] , tone: "warn" },
            { cells: ["Pick Dr. A. Sinha from the doctor list", "Name, qualification and registration no. filled in"], tone: "ok" },
            { cells: ["F9 complete", "Sale saved with patient and prescriber; register updated"], tone: "ok" },
          ],
        },
      ],
    },
    highlights: [
      { h: "Prescriber on the bill", p: "Prescription-only medicines can't be billed without a prescriber, and typed names still work for walk-in prescriptions.", points: ["Doctor master with registration no.", "Quick-add from the counter", "Sales by doctor report"] },
      { h: "Register on demand", p: "The register is a report over append-only bills, so it is always complete and can't be rewritten later.", points: ["Any date range", "On screen, print or CSV", "Patient, prescriber, drug, batch, quantity"] },
      { h: "Orders with prescriptions", p: "Phone and WhatsApp orders keep the prescription photo with the order through billing and delivery.", points: ["Prescription photo on orders", "Audit trail on every change", "Role-based access to customer data"] },
    ],
    faq: [
      ["What does the law require for Schedule H1 drugs?", "Under the Drugs and Cosmetics Rules, 1945, the supply of a Schedule H1 drug has to be recorded in a separate register with the name and address of the prescriber, the name of the patient, the name of the drug and the quantity supplied, and the register is kept for three years and open to inspection. Check the current rules with your state drug control office."],
      ["Does Medoro make my pharmacy compliant?", "Medoro records what the register needs from every bill and makes it easy to print or export, but compliance stays the responsibility of the registered pharmacist. Medoro is business software and does not give clinical or legal advice."],
      ["Which medicines go into the register?", "Medicines marked Schedule H1, X or NDPS in your medicine master. Schedule H medicines ask for a prescriber at billing too, and can be filtered in reports."],
      ["Can I export the register for an inspection?", "Yes. Choose the date range and print it or download a CSV that opens in Excel."],
    ],
    tools: ["free-pharmacy-invoice-generator", "medicine-hsn-code-finder"],
    related: ["gst-billing", "expiry-management", "inventory-management"],
  },
  {
    slug: "ai-invoice-scanner",
    name: "AI purchase bill import",
    title: "AI Purchase Bill Import for Pharmacies: CSV, Excel, PDF",
    description: "Import distributor purchase bills from CSV, Excel or text e-bills, or scan a PDF or photo. Columns auto-detected, items matched, totals checked before stock.",
    keywords: ["pharmacy purchase bill import", "distributor bill import pharmacy", "marg e-bill import", "pharmacy invoice scanner", "purchase entry automation pharmacy"],
    eyebrow: "AI distributor CSV/PDF purchase bill import",
    h1: "Stop typing distributor bills line by line.",
    intro: "Import the e-bill your distributor sends (CSV, Excel, or pipe/tab text exported from Marg, BUSY, Logic and others), or scan a PDF or photo of the printed bill. Medoro detects the columns, matches each line to your medicines, and fills batch, expiry, quantity, free, PTR, PTS, MRP, scheme and discounts. Nothing reaches stock until your total matches the printed one.",
    plan: "Professional",
    problems: [
      { pain: "A 60-line distributor bill takes 20 minutes to type, and a wrong expiry or MRP slips through.", fix: "Lines arrive from the distributor's own file with batch, expiry, quantity, free, PTR, PTS and MRP already filled in." },
      { pain: "Every distributor's file looks different.", fix: "Header detection matches common column names (B.No, Exp, Sch Qty, M.R.P., PTR, TD, CD %, HSN…). For headerless files you map columns once, and the mapping is saved for that supplier." },
      { pain: "Distributor item names don't match yours.", fix: "Matching goes barcode → the supplier's item code learned from earlier bills → learned name and pack → fuzzy name. Fuzzy matches must be ticked as verified before posting." },
      { pain: "Free goods and schemes make the real cost unclear.", fix: "Landed cost per unit spreads free quantity, scheme, trade and cash discounts, and the margin on MRP shows on every line as you review." },
    ],
    mockup: {
      window: "Purchases · Import e-bill",
      views: [
        {
          tab: "Matched lines", caption: "A distributor CSV after column detection and item matching.",
          columns: ["Distributor item", "Matched to", "Batch", "Exp", "Qty+Free", "PTR", "MRP", "Match"],
          rows: [
            { cells: ["DOLO-650 TAB", "Dolo 650 Tablet 15's", "DOBS3021", "08/27", "100+10", "₹24.00", "₹33.60", "Barcode"], tone: "ok" },
            { cells: ["PAN D CAP 15", "Pan-D Capsule 15's", "PDK24117", "03/27", "20+0", "₹142.14", "₹199.00", "Supplier code"], tone: "ok" },
            { cells: ["MONTAIR-LC 15T", "Montair LC Tablet 15's", "MLC9921", "01/27", "10+1", "₹163.93", "₹229.50", "Fuzzy · verify"], tone: "warn" },
          ],
          footer: [["Lines", "58"], ["Bill total", "₹48,212.00"], ["Your total", "₹48,212.40 ✓"]],
        },
        {
          tab: "Column map", caption: "Detected columns from a headerless pipe-separated file, saved for this supplier.",
          columns: ["File column", "Sample", "Medoro field"],
          rows: [
            { cells: ["Col 3", "DOLO-650 TAB", "Item name"], tone: "ok" },
            { cells: ["Col 5", "DOBS3021", "Batch"], tone: "ok" },
            { cells: ["Col 6", "08/27", "Expiry"], tone: "ok" },
            { cells: ["Col 9", "24.00", "PTR"], tone: "ok" },
          ],
          footer: [["Mapping", "Saved for Shree Balaji Pharma"]],
        },
      ],
    },
    highlights: [
      { h: "Any distributor file", p: "CSV (comma, semicolon or tab), Excel .xlsx, and .txt/.dat/.prn pipe files, with letterhead rows skipped.", points: ["Header detection", "Column mapper saved per supplier", "Record-type filters for H|D|T files"] },
      { h: "Scan printed bills", p: "Upload a PDF or photo of a printed bill to the invoice queue and review it line by line.", points: ["PDF, JPG, PNG and WebP", "Low-confidence lines must be verified", "Printed total must match within ₹1"] },
      { h: "Pharma pricing built in", p: "PTR, PTS, MRP, free goods (\"10+2\"), scheme, trade and cash discounts, and the GST base you choose.", points: ["Landed cost per unit", "Margin on MRP per line", "IGST for out-of-state suppliers"] },
    ],
    faq: [
      ["Which distributor bill formats can Medoro import?", "CSV with comma, semicolon or tab separators, Excel .xlsx files, and .txt/.dat/.prn files where lines are pipe-separated, which covers e-bills exported from most distributor software. Old binary .xls files need to be saved as .xlsx first."],
      ["Does it work with bills from distributors using Marg?", "Yes. Marg and similar software export bills as CSV, Excel or delimited text. Medoro reads these files, and if the columns aren't recognised you map them once; the mapping is remembered for that distributor."],
      ["What happens if an item doesn't match?", "Unmatched lines are resolved in the import dialog: pick the right medicine or create a new one prefilled from the bill. Medoro remembers the distributor's code and name for next time."],
      ["Can I scan a printed or PDF bill?", "Yes, on the Professional plan and above. Upload a PDF or photo to the supplier invoice queue; lines that were read with low confidence have to be ticked as verified, and the bill can't be posted until your total matches the printed total within ₹1."],
    ],
    tools: ["pharma-margin-calculator", "medicine-hsn-code-finder"],
    related: ["inventory-management", "expiry-management", "gst-billing"],
  },
];

export const featureBySlug = (slug: string) => FEATURES.find((f) => f.slug === slug);
