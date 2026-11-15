/**
 * Search landing pages: one page per phrase pharmacy owners type into Google ("pharmacy billing software",
 * "medical store software", ...). Each page has its own wording, so Google treats them as separate answers, not copies
 * of the homepage. Every claim here is something the product does today (same facts as the homepage feature tabs):
 * keep it that way when editing.
 *
 * Adding a page: add an entry here and a folder src/app/<slug>/page.tsx that renders <LandingPage slug="<slug>" />.
 * The sitemap, footer links and "related pages" pick it up from this list.
 */
export type Landing = {
  slug: string;
  /** Short name for links and breadcrumbs. */
  name: string;
  /** <title>, under ~60 characters, the search phrase first. */
  title: string;
  /** Meta description, under ~160 characters. */
  description: string;
  eyebrow: string;
  h1: string;
  intro: string;
  img: [src: string, alt: string];
  sections: { h: string; p: string; points: string[] }[];
  faq: [q: string, a: string][];
};

export const LANDINGS: Landing[] = [
  {
    slug: "medical-billing-saas",
    name: "Medical billing SaaS",
    title: "Medical Billing SaaS & Cloud Healthcare Billing Software",
    description: "Medoro is a cloud medical billing SaaS for Indian medical stores, clinic and hospital pharmacies: GST bills, batch stock, expiry and accounts. 7-day free trial.",
    eyebrow: "Medical billing SaaS · cloud healthcare billing software in India",
    h1: "Medical billing SaaS for India’s medical stores and pharmacies.",
    intro: "Medoro is cloud healthcare billing software for the place medicines are sold: the retail chemist, the clinic dispensary and the hospital pharmacy counter. Open it in a browser or the desktop app, bill in three keys with GST worked out on every line, and see sales, stock and dues on your phone.",
    img: ["/site/dashboard.webp", "Medoro medical billing SaaS dashboard: today’s sales, margin, receivables, low stock and batches expiring within 90 days"],
    sections: [
      { h: "Cloud billing on any device", p: "Open Medoro in Chrome on a PC, tablet or phone, or install the desktop app on the shop PC. Every counter and the owner’s phone see the same live numbers.", points: ["Works in Chrome on any device", "Desktop app for Windows, macOS and Linux", "Sales, cash and dues on the owner’s phone"] },
      { h: "Medical store and chemist billing", p: "F2 to search by brand, salt or barcode, Enter to add, F9 to finish. The earliest-expiring batch is picked on every line and expired stock cannot be billed.", points: ["FEFO batch picking", "Cash, UPI, card, split payments and credit", "Thermal, A4 and WhatsApp invoices"] },
      { h: "Clinic and hospital pharmacy billing", p: "Long prescriptions, prescription-only medicines and institutional sales at one counter. The prescriber goes on the bill and the Schedule H1 register fills itself.", points: ["Prescriber captured on every Rx bill", "B2B tax invoices with the buyer’s GSTIN", "Credit accounts with limits and statements"] },
      { h: "GST and accounts built in", p: "Each line carries its taxable value with CGST and SGST, or IGST. Sales, purchases and payments post to the books as they happen, so month-end is a summary, not a project.", points: ["GSTR-1 and GSTR-3B summaries", "Day book, P&L and party ledgers", "Tally and Excel export for your CA"] },
      { h: "Keeps billing when the internet drops", p: "SaaS should not stop the counter. Installed counters keep billing offline and sync when the connection is back.", points: ["Offline billing on the shop network", "Bills sync automatically", "Encrypted daily backups to your Google Drive"] },
      { h: "A subscription you can leave", p: "Monthly or yearly plans in rupees, paid by UPI, card or netbanking. Plans never renew on their own, and your data can be exported in full at any time.", points: ["From ₹999 a month for one store", "7-day free trial, no card needed", "Full data export any time"] },
    ],
    faq: [
      ["What is medical billing SaaS?", "Medical billing SaaS is billing software for a healthcare business that you pay for by subscription and use over the internet, instead of buying a licence for one PC. Medoro is medical billing SaaS for pharmacies: it bills medicines with batch, expiry and GST, and keeps stock and accounts up to date as you sell."],
      ["Who is Medoro medical billing SaaS for?", "Retail medical stores and chemists, pharmacies inside or next to clinics, hospitals and nursing homes, and pharmacy chains of up to 5 branches on the Multi-branch plan."],
      ["Does Medoro handle health-insurance claims or hospital patient billing?", "No. Medoro bills medicines at a medical store, clinic or hospital pharmacy counter. It does not submit insurance or TPA claims, and it is not a hospital information system for OPD or IPD charges."],
      ["Is my data safe in cloud billing software?", "Medoro loads only over HTTPS, owners and managers sign in with a second step, and every void, discount and stock adjustment is logged. Backups are encrypted before they leave your computer and go to your own Google Drive, and you can export all your data at any time."],
      ["How much does Medoro medical billing SaaS cost?", "Medoro starts at ₹999 a month for one store. There is a 7-day free trial with no card needed, and plans never renew on their own."],
    ],
  },
  {
    slug: "pharmacy-billing-software",
    name: "Pharmacy billing software",
    title: "Best Pharmacy Billing Software & Chemist POS in India",
    description: "Medoro pharmacy billing software and chemist POS for India: three-key billing, FEFO batches, GST invoices, barcode search and WhatsApp bills. 7-day free trial.",
    eyebrow: "Pharmacy billing software & chemist POS in India",
    h1: "Pharmacy billing software and chemist POS that keeps the counter moving.",
    intro: "Medoro is pharmacy billing software and a chemist POS made for Indian medical stores. Search by brand, salt or barcode, add the item, and finish the bill in three keys. The earliest-expiring batch is picked for you, GST is split on every line, and the invoice prints on your thermal printer or goes to the customer on WhatsApp.",
    img: ["/site/pos.webp", "Medoro pharmacy billing screen with Dolo 650, Pan-D and Azithral 500 in the cart, batch picked by expiry and UPI payment"],
    sections: [
      { h: "Billing in three keys", p: "F2 to search by brand name, salt or barcode, Enter to add, F9 to complete the sale. Held carts let you serve the next customer while one waits.", points: ["Brand, salt and barcode search", "Held carts, returns and credit notes", "80 mm thermal and A4 invoices"] },
      { h: "Batch and expiry picked for you", p: "FEFO (first expiry, first out) chooses the batch on every line. Expired or quarantined stock is blocked, even if someone selects it by hand.", points: ["Earliest-expiring batch sells first", "Expired stock can’t be billed", "Batch and expiry printed on the bill"] },
      { h: "Schedule H and H1 ready", p: "Medicines that need a prescription ask for the prescriber before the bill closes, and the details stay on record with the sale.", points: ["Prescriber captured on the bill", "Doctor list for quick entry", "Records kept with each sale"] },
      { h: "Every way customers pay", p: "Cash, UPI, card, split payments and customer credit with limits. Customer dues are tracked automatically.", points: ["Split payments on one bill", "Credit limits per customer", "Dues and collections on your phone"] },
      { h: "Keeps billing without internet", p: "Run Medoro on a PC in your shop and every counter on the shop network keeps billing when the internet drops. Bills sync when it comes back.", points: ["Desktop app for Windows, macOS and Linux", "Or open it in Chrome on any device", "Offline bills sync automatically"] },
    ],
    faq: [
      ["Which is the best billing software for a medical store?", "Look for fast keyboard billing, automatic batch and expiry picking, GST-ready invoices, Schedule H support, offline billing and an easy way to move your existing stock in. Medoro does all of these, and you can try it free for 7 days with your own data."],
      ["Is Medoro a chemist POS as well as billing software?", "Yes. The billing screen is a keyboard-first point of sale for the chemist counter: barcode and salt search, held carts, split payments, returns and shift closing, with stock and accounts updated by every bill."],
      ["Does Medoro work with a barcode scanner and thermal printer?", "Yes. Medoro works with USB barcode scanners and 80 mm thermal printers, and also prints A4 invoices. Printer and scanner setup is included."],
      ["Can I send the bill to the customer on WhatsApp?", "Yes. The PDF invoice goes through the official WhatsApp Business API, and you can see when it was delivered and read."],
      ["How much does pharmacy billing software cost?", "Medoro starts at ₹999 a month for one store, GST included. There is a 7-day free trial with no card needed, and plans never renew on their own."],
    ],
  },
  {
    slug: "pharmacy-accounting-software",
    name: "Pharmacy accounting software",
    title: "Pharmacy Accounting Software with GST and Tally Export",
    description: "Pharmacy accounting software with day book, P&L, ledgers, trial balance, supplier dues, GSTR-1 and GSTR-3B summaries and Tally export. Try free for 7 days.",
    eyebrow: "Pharmacy accounting software",
    h1: "Pharmacy accounting that is done when the bill is.",
    intro: "Every sale, purchase, return and payment in Medoro posts to your accounts as it happens. Your day book, profit and loss, ledgers and GST summaries are always up to date, and your CA gets exports in the format they already use, including Tally.",
    img: ["/site/accounts.webp", "Medoro pharmacy accounting: profit and loss, cash and bank, GST summary by slab and the day book"],
    sections: [
      { h: "Books that keep themselves", p: "Sales, purchases, returns, expenses and payments post automatically. Corrections post as reversals, so the history is never rewritten.", points: ["Day book and cash book", "Profit and loss and trial balance", "Party ledgers for customers and suppliers"] },
      { h: "Supplier dues under control", p: "Purchases carry the distributor’s due date. See what you owe and when, and record payments with vouchers.", points: ["Supplier dues with due dates", "Payment vouchers", "Customer credit and collections"] },
      { h: "GST figures ready on the 1st", p: "Every line carries its taxable value with CGST and SGST, or IGST for out-of-state parties. Month-end summaries are ready for filing.", points: ["GSTR-1 and GSTR-3B summaries", "Output and input tax by slab", "E-invoice for B2B bills where required"] },
      { h: "Your CA gets what they need", p: "Export to Tally, or CSV files that open in Excel. No retyping, no reworking figures at month-end.", points: ["Tally export", "CSV reports for Excel", "Full data export any time"] },
      { h: "Margin you can actually see", p: "Sales, margin, cash and dues for every branch on your phone, so you know the numbers even when you are away from the shop.", points: ["Daily sales and margin", "Branch and consolidated reports", "Owner’s view on the phone"] },
    ],
    faq: [
      ["Do I still need Tally if I use Medoro?", "Medoro keeps the books for your pharmacy: day book, ledgers, P&L and trial balance. If your CA works in Tally, export the data to Tally from Medoro instead of entering it again."],
      ["Does Medoro prepare GSTR-1 and GSTR-3B?", "Medoro prepares the GSTR-1 and GSTR-3B summaries from your bills and purchases so they are ready for filing on the 1st. Filing itself is done on the GST portal by you or your CA."],
      ["Can I track supplier and customer outstanding?", "Yes. Supplier dues are tracked with the distributor’s due dates, and customer credit is tracked with limits and collections."],
      ["Can my accountant get the reports?", "Yes. Reports export as CSV that opens in Excel, and there is a Tally export for accountants who use Tally."],
    ],
  },
  {
    slug: "medical-store-software",
    name: "Medical store software",
    title: "Medical Store Software: Billing, Stock, Expiry and GST",
    description: "All-in-one medical store software for Indian chemists: billing, batch stock, expiry alerts, purchases, GST and accounts. English and Hindi. 7-day free trial.",
    eyebrow: "Medical store software",
    h1: "One software for your whole medical store.",
    intro: "Medoro runs the counter, the godown and the books of an Indian medical store or chemist shop. Billing, batch-wise stock, expiry, purchases from distributors, GST and accounts are in one place, in English or हिंदी, on the shop PC, a tablet or your phone.",
    img: ["/site/dashboard.webp", "Medoro dashboard for a medical store: today’s sales, margin, receivables, low stock and batches expiring within 90 days"],
    sections: [
      { h: "Billing at the counter", p: "Keyboard-first billing with brand, salt and barcode search, automatic batch picking and GST invoices on thermal or A4 paper.", points: ["Bill in three keys", "Schedule H and H1 prescriber capture", "Cash, UPI, card and credit"] },
      { h: "Stock and expiry", p: "Every batch is tracked with expiry, rack and cost. See what expires in the next 90 days while you can still return it to the distributor.", points: ["30, 60, 90 and 180-day expiry windows", "Low-stock list from sales", "Recalls quarantine matching batches"] },
      { h: "Purchases from distributors", p: "Receive the distributor’s bill against your order. Import the supplier’s e-bill file or scan the printed invoice, and nothing reaches stock until your total matches the bill.", points: ["Purchase orders and GRN", "Supplier e-bill import", "Free quantity and rate on every line"] },
      { h: "GST and accounts", p: "GST summaries ready at month-end, day book, P&L and ledgers kept up to date, and exports for your CA.", points: ["GSTR-1 and GSTR-3B summaries", "Tally and Excel export", "Supplier and customer dues"] },
      { h: "Made for Indian pharmacies", p: "Full Hindi interface, WhatsApp invoices and refill reminders, daily encrypted backups to your own Google Drive, and support on WhatsApp.", points: ["English and हिंदी", "WhatsApp invoices and refill reminders", "Backups to your Google Drive"] },
    ],
    faq: [
      ["Is Medoro suitable for a small chemist shop?", "Yes. The Starter plan at ₹999 a month is made for a single medical store. Larger stores and chains can move to Professional or Multi-branch."],
      ["Can my staff use the software in Hindi?", "Yes. Each person can switch the interface between English and हिंदी, and the assistant understands English, Hindi and Hinglish."],
      ["Can I move my stock from my current medical store software?", "Yes. Export medicines, batches, suppliers and customers to Excel from your current software and import them into Medoro. Every row is checked before anything is imported."],
      ["Does it need internet all the time?", "No. When Medoro runs on a PC in your shop, every counter on the shop network keeps billing while the internet is down."],
    ],
  },
  {
    slug: "gst-billing-software-for-pharmacy",
    name: "GST billing software for pharmacy",
    title: "GST Billing Software for Pharmacy and Medical Stores",
    description: "GST billing software for pharmacies: MRP-inclusive pricing, CGST, SGST and IGST split on every line, GSTR-1 and GSTR-3B summaries, e-invoice and Tally export.",
    eyebrow: "GST billing for pharmacy",
    h1: "GST billing for pharmacies, without month-end Excel.",
    intro: "Medicines are sold at MRP, but GST has to be worked out on every line. Medoro does it as you bill: each line carries its taxable value and the CGST and SGST split, or IGST for out-of-state parties, so your GST summaries are ready on the 1st of the month.",
    img: ["/site/accounts.webp", "Medoro GST summary by slab with output and input tax for a pharmacy"],
    sections: [
      { h: "MRP-inclusive, GST-correct", p: "Prices are MRP-inclusive. The taxable value and tax are worked out on every line, at the right slab for each medicine.", points: ["CGST and SGST split on every line", "IGST for out-of-state parties", "HSN and GST rate per item"] },
      { h: "Input tax from purchases", p: "Purchases record the GST on the distributor’s bill, so output and input tax are both ready by slab.", points: ["Input tax from every purchase", "Output and input tax by slab", "Supplier e-bill import"] },
      { h: "Returns ready at month-end", p: "GSTR-1 and GSTR-3B summaries are prepared from your bills and purchases, ready for you or your CA to file.", points: ["GSTR-1 summary", "GSTR-3B summary", "Credit notes for returns"] },
      { h: "B2B and e-invoice", p: "Bills to hospitals, clinics and other businesses carry the buyer’s GSTIN, with e-invoice where your turnover requires it.", points: ["Buyer GSTIN on B2B bills", "E-invoice where required", "A4 tax invoices"] },
      { h: "Exports for your CA", p: "Tally export and CSV that opens in Excel, so your CA doesn’t retype anything.", points: ["Tally export", "CSV for Excel", "Day book and ledgers"] },
    ],
    faq: [
      ["How is GST calculated on medicines sold at MRP?", "MRP includes GST. Medoro works out the taxable value from the MRP and the item’s GST rate, then splits the tax into CGST and SGST, or IGST for out-of-state sales, on every line of the bill."],
      ["Does Medoro file GST returns?", "Medoro prepares the GSTR-1 and GSTR-3B summaries. You or your CA file them on the GST portal."],
      ["Does it support e-invoicing?", "Yes. B2B bills can be issued as e-invoices where your turnover requires it."],
      ["Is the price GST inclusive?", "Yes. Medoro’s plan prices include GST, starting at ₹999 a month."],
    ],
  },
  {
    slug: "pharmacy-inventory-software",
    name: "Pharmacy inventory software",
    title: "Pharmacy Inventory and Expiry Management Software",
    description: "Pharmacy inventory software with batch-wise stock, 90-day expiry alerts, projected loss, low-stock reorder lists, purchases and GRN, and branch stock transfers.",
    eyebrow: "Pharmacy inventory software",
    h1: "Stop losing money to expired stock.",
    intro: "Medoro tracks every batch in your pharmacy with its expiry, rack and cost. It shows which batches will not sell before they expire, how much that will cost you, and what to do about it, early enough to return them or move them.",
    img: ["/site/expiry.webp", "Medoro expiry management: batches expiring in 90 days with days left, projected loss at cost and a recommendation for each"],
    sections: [
      { h: "Expiry you see in time", p: "Windows for 30, 60, 90 and 180 days. Each batch shows how much will not sell in time and the loss at cost.", points: ["Projected loss per batch", "Return, transfer or push-to-customer suggestions", "FEFO billing sells the earliest expiry first"] },
      { h: "Batch-wise stock", p: "Stock is kept per batch with expiry, rack location and purchase cost. Stock counts and adjustments are logged with who and when.", points: ["Batch, expiry and rack", "Stock count with variance", "Audit trail on adjustments"] },
      { h: "Reorder before you run out", p: "The low-stock list uses your reorder levels and the last 28 days of sales. The assistant can draft a purchase order for you to review.", points: ["Reorder levels per item", "28-day sales velocity", "Draft purchase orders"] },
      { h: "Purchases that check the bill", p: "Receive the distributor’s bill against your order. Nothing reaches stock until the lines are complete and your total matches the printed one.", points: ["Supplier e-bill import and invoice scanning", "Free quantity on every line", "GRN posting"] },
      { h: "Branches and recalls", p: "Move stock between branches with approval. A recall quarantines matching batches across every branch at once.", points: ["Approved stock transfers", "Up to 5 branches", "Recall quarantine"] },
    ],
    faq: [
      ["How does Medoro reduce expiry loss?", "It lists batches expiring in the next 30 to 180 days, projects how much of each will not sell in time, values the loss at cost, and suggests returning it to a supplier, moving it to another branch or offering it to regular customers."],
      ["Can I manage stock for more than one store?", "Yes. The Multi-branch plan covers up to 5 branches with approved stock transfers and branch and consolidated reports."],
      ["Does it work with barcodes?", "Yes. Search and bill by barcode, brand or salt name with a USB barcode scanner."],
      ["Can I import my existing stock?", "Yes. Import medicines and batches from Excel or CSV. Every row is checked for expiry, GST rate and MRP against cost before anything is imported."],
    ],
  },
  {
    slug: "medical-store-stock-management-software",
    name: "Medical store stock management software",
    title: "Medical Store Stock, Batch & Inventory Management SaaS",
    description: "Medical store stock management SaaS with batch-wise inventory, near-expiry alerts, reorder lists, purchase bill import and stock counts. Try Medoro free for 7 days.",
    eyebrow: "Medical store stock, batch & inventory management SaaS",
    h1: "Medical store stock management, batch by batch.",
    intro: "Medoro is stock management software for medical stores that knows a strip of Dolo is not just a quantity: it has a batch, an expiry, a rack and a cost. Stock moves with every bill and every purchase, so what the screen says is what is on the shelf.",
    img: ["/site/purchases.webp", "Medoro stock management: receiving a distributor’s invoice against a purchase order with batch and expiry entered and the total matching the printed bill"],
    sections: [
      { h: "Stock that is always current", p: "Sales, returns, purchases and transfers change stock the moment they are saved. There is no end-of-day posting and no second register to keep.", points: ["Live stock on every counter", "Strip and loose-tablet quantities", "Stock visible on the owner’s phone"] },
      { h: "Batch and near-expiry control", p: "Every batch carries its expiry. Medoro lists what expires in 30, 60, 90 and 180 days with the loss at cost, while there is still time to return it or sell it.", points: ["Near-expiry list with projected loss", "FEFO billing sells the earliest expiry first", "Expired and recalled batches blocked"] },
      { h: "Reorder lists from real sales", p: "The low-stock list is built from your reorder levels and the last 28 days of sales, and can become a draft purchase order for you to review.", points: ["Reorder level per medicine", "28-day sales velocity", "Draft purchase orders"] },
      { h: "Purchases in without typing", p: "Import the distributor’s e-bill from CSV or Excel, or scan the printed invoice. Batch, expiry, free quantity and rate land on each line, and nothing reaches stock until the total matches the bill.", points: ["Supplier e-bill import", "AI invoice scanning", "Purchase orders and GRN"] },
      { h: "Counts, racks and an audit trail", p: "Give every medicine a rack location, count the shelves and post the variance. Each adjustment is logged with who made it and when.", points: ["Rack locations", "Stock count with variance", "Logged stock adjustments"] },
      { h: "More than one store", p: "Move stock between branches with approval and see each branch and the whole business in one report on the Multi-branch plan.", points: ["Approved stock transfers", "Up to 5 branches", "Branch and consolidated reports"] },
    ],
    faq: [
      ["How do I manage medicine stock in a medical store?", "Keep stock batch-wise with expiry, let billing reduce it automatically, receive purchases against the distributor’s bill, and review the near-expiry and low-stock lists every week. Medoro does the record-keeping for each of these steps and shows the two lists on your dashboard."],
      ["Does stock update automatically when I bill?", "Yes. Every sale, return, purchase and transfer updates the batch it touches as soon as it is saved, on every counter."],
      ["Can I import my opening stock from Excel or my current software?", "Yes. Export medicines and batch-wise stock to Excel or CSV from your current software, including Marg and Vyapar, and import the file into Medoro. Every row is checked for expiry, GST rate and MRP against cost before anything is imported."],
      ["Can I check my medical store’s stock from my phone?", "Yes. The owner’s view on the phone shows sales, cash and dues with the low-stock and near-expiry lists that need attention."],
      ["How much does Medoro stock management software cost?", "Stock, batch and expiry management is included in every plan, starting at ₹999 a month for one store, with a 7-day free trial and no card needed."],
    ],
  },
];

export const landing = (slug: string) => LANDINGS.find((l) => l.slug === slug)!;
