/**
 * Blog articles for search: practical answers to questions pharmacy owners type into Google. Each article links to
 * the matching product page. Body blocks are plain data so no Markdown library is needed; inside text,
 * [label](/path) becomes an internal link.
 *
 * Regulatory and tax facts must be checked against official sources before publishing, and dated with `updated`.
 * Add a new article to the top of the list (newest first).
 */
export type Block =
  | { h2: string }
  | { p: string }
  | { ul: string[] }
  | { ol: string[] }
  | { note: string };

export type Post = {
  slug: string;
  title: string;
  description: string;
  published: string;
  updated: string;
  minutes: number;
  /** A product page path this article leads to. */
  cta: { href: string; text: string };
  body: Block[];
};

export const POSTS: Post[] = [
  {
    slug: "reduce-expiry-loss-medical-store",
    title: "How to Reduce Expiry Loss in a Medical Store: 8 Practical Steps",
    description: "Expired medicines quietly eat a pharmacy’s margin. Eight practical steps to cut expiry loss: FEFO, 90-day reviews, distributor returns, smarter ordering and more.",
    published: "2026-11-15", updated: "2026-11-15", minutes: 6,
    cta: { href: "/pharmacy-inventory-software", text: "See how Medoro tracks expiry" },
    body: [
      { p: "Ask any medical store owner where money disappears and expired stock is near the top of the list. A strip that expires on the shelf is a full loss at cost, and in a busy store those strips add up to thousands of rupees every month. The good news is that most expiry loss is preventable. It comes from a few habits that are easy to fix." },
      { h2: "1. Sell the earliest expiry first (FEFO)" },
      { p: "FEFO means First Expiry, First Out: whenever you sell a medicine, the batch that expires soonest goes first. It sounds obvious, but at a busy counter the staff pick whatever strip is at the front of the rack. If a newer batch was stacked in front of an older one, the older one sits until it expires. Read more in our guide to [FEFO vs FIFO](/blog/fefo-vs-fifo-pharmacy)." },
      { ul: ["Arrange racks so older batches are in front", "Pick the batch on the bill, not by hand, so the system chooses the earliest expiry", "Block expired batches from being billed at all"] },
      { h2: "2. Review a 90-day expiry list every week" },
      { p: "Most distributors accept near-expiry returns only within a window, often a few months before expiry. If you find out about a batch in the month it expires, it is already too late. Keep a list of every batch expiring in the next 90 days and look at it once a week. For each batch, decide: will it sell in time, or does it need action?" },
      { h2: "3. Know the loss in rupees, not just the quantity" },
      { p: "Ten strips of a cheap antacid and ten strips of an expensive biologic are not the same problem. Value every near-expiry batch at cost and sort by the loss. Start with the batches that would cost you the most. This turns a long, boring list into three or four decisions that matter." },
      { h2: "4. Return to the distributor while you still can" },
      { p: "Find out each distributor’s return policy for near-expiry stock: how many months before expiry they accept returns, and whether they give credit or replacement. Note it against the supplier. When a batch enters the return window and is unlikely to sell, send it back instead of waiting." },
      { h2: "5. Move stock between branches" },
      { p: "If you run more than one store, a medicine that sells slowly in one branch may sell well in another. Transfer near-expiry stock to the branch where it moves fastest, with a proper transfer record so both branches’ stock stays correct." },
      { h2: "6. Order by sales, not by habit" },
      { p: "Overstocking is the root of most expiry. Instead of reordering the same quantity every time, look at how much actually sold in the last four weeks and set a reorder level from that. Slow movers should be bought in smaller quantities, more often." },
      { ul: ["Set a reorder level for each item based on recent sales", "Be careful with schemes like ‘10+1 free’ on slow-moving items: the free strip is not free if it expires", "Check the expiry date on the distributor’s bill before you accept the delivery"] },
      { h2: "7. Tell regular customers" },
      { p: "Patients on long-term medicines buy the same thing every month. If you have stock of their medicine that needs to move, a refill reminder brings them back before it expires, and they get their medicine on time." },
      { h2: "8. Count stock regularly" },
      { p: "Expiry lists are only as good as your stock records. If the system says you have two strips and the rack has twelve, the problem stays hidden. Do a short cycle count of a few racks each week, rather than one painful full count a year." },
      { h2: "How software helps" },
      { p: "Doing all of this on paper is possible but slow. Good [pharmacy inventory software](/pharmacy-inventory-software) picks the earliest batch on every bill, lists what expires in the next 30, 60, 90 or 180 days with the loss at cost, and suggests whether to return, transfer or push each batch. It turns expiry from a monthly surprise into a weekly ten-minute review." },
    ],
  },
  {
    slug: "gst-on-medicines-india",
    title: "GST on Medicines in India (2026): Rates, HSN and Billing at MRP",
    description: "GST rates on medicines after the September 2025 cut, how to work out GST from the MRP on a pharmacy bill, HSN codes, and common mistakes medical stores make.",
    published: "2026-11-15", updated: "2026-11-15", minutes: 7,
    cta: { href: "/gst-billing-software-for-pharmacy", text: "See GST billing in Medoro" },
    body: [
      { note: "This is a general guide for medical store owners, not tax advice. Rates can change by notification: check the current rate for each product with your CA or on the CBIC website." },
      { h2: "GST rates on medicines after September 2025" },
      { p: "On 22 September 2025, the GST rate on most medicines came down from 12% to 5% as part of the GST rate rationalisation. A list of life-saving drugs, including several cancer and rare-disease medicines, moved to nil GST. Some products sold in pharmacies that are not medicines, such as many cosmetics and personal-care items, are taxed at their own rates, often 18%." },
      { ul: ["Most medicines (HSN 3003 and 3004): 5%", "Notified life-saving drugs: nil", "Non-medicine items in the store: as per their own HSN, check each one"] },
      { p: "Because the rate changed, your item master must carry the correct rate for each product. A store that still bills at the old 12% rate on medicines charges customers the wrong amount and reports the wrong tax." },
      { h2: "How GST is calculated when you sell at MRP" },
      { p: "Medicines are sold at MRP, and the MRP already includes GST. So the bill must work backwards from the MRP to find the taxable value and the tax. The formula is:" },
      { p: "Taxable value = Selling price ÷ (1 + GST rate). Tax = Selling price − Taxable value." },
      { p: "Example: a medicine with an MRP of ₹105 at 5% GST. Taxable value = 105 ÷ 1.05 = ₹100. Tax = ₹5. For a sale within your state, that is split into CGST ₹2.50 and SGST ₹2.50. For a sale to a business in another state, it is IGST ₹5." },
      { p: "If you give a discount, apply it to the selling price first and then work out the taxable value from the discounted price." },
      { h2: "HSN codes pharmacies use most" },
      { ul: ["3004: medicaments in measured doses or packed for retail sale (most tablets, capsules, syrups, injections)", "3003: medicaments not in measured doses", "3005: bandages, dressings and similar", "3006: certain pharmaceutical goods such as sterile sutures and first-aid kits"] },
      { p: "Your bills must show the HSN code at the level your turnover requires. Keep it in the item master so it prints on every bill automatically." },
      { h2: "Purchases and input tax credit" },
      { p: "The GST on your distributor’s bill is your input tax. You claim it as credit against the GST you collect on sales, as long as the distributor has reported the invoice in their GSTR-1. Record purchases with the correct rate and the distributor’s GSTIN, and check them against your GSTR-2B every month." },
      { h2: "Common GST mistakes in medical stores" },
      { ul: ["Wrong rate in the item master after a rate change", "Adding GST on top of MRP instead of working it out from MRP", "Not issuing credit notes for sales returns, so tax is overpaid", "Missing the buyer’s GSTIN on B2B bills to clinics and hospitals", "Entering purchases late, so input credit does not match GSTR-2B"] },
      { h2: "Let the software do the maths" },
      { p: "[GST billing software for pharmacy](/gst-billing-software-for-pharmacy) works out the taxable value from MRP on every line, splits CGST and SGST or IGST, prints the HSN code and keeps output and input tax by slab, so your month-end summaries are ready without a spreadsheet. See also our [GSTR-1 and GSTR-3B checklist for pharmacies](/blog/gst-returns-for-pharmacy)." },
    ],
  },
  {
    slug: "gst-returns-for-pharmacy",
    title: "GSTR-1 and GSTR-3B for Pharmacies: A Monthly Checklist",
    description: "A simple monthly GST checklist for medical stores: what goes into GSTR-1 and GSTR-3B, due dates, QRMP, input credit checks and how to avoid late fees.",
    published: "2026-11-15", updated: "2026-11-15", minutes: 6,
    cta: { href: "/pharmacy-accounting-software", text: "See accounts and GST in Medoro" },
    body: [
      { note: "Due dates and rules can change by notification. Confirm the current dates on the GST portal or with your CA before filing." },
      { h2: "The two returns most pharmacies file" },
      { p: "A regular GST-registered medical store files two main returns. GSTR-1 reports your sales. GSTR-3B is the summary return where you pay the tax: GST collected on sales minus the input credit from purchases." },
      { h2: "Due dates" },
      { ul: ["Monthly filers: GSTR-1 by the 11th and GSTR-3B by the 20th of the next month", "QRMP scheme (turnover up to ₹5 crore, if you opt in): GSTR-1 and GSTR-3B quarterly, with tax paid monthly by the 25th using PMT-06", "Late GSTR-3B attracts a late fee per day plus interest on unpaid tax, so file on time even if the amount is small"] },
      { h2: "Monthly checklist" },
      { ol: [
        "Close the month’s billing: no held or draft bills left open",
        "Enter every distributor bill received in the month, with GSTIN, invoice number, rate and tax",
        "Issue credit notes for every sales return and debit notes for purchase returns",
        "Check B2B bills carry the buyer’s GSTIN and correct place of supply",
        "Download GSTR-2B and match it with your purchase register; follow up with distributors whose invoices are missing",
        "Prepare the GSTR-1 summary: B2B invoices, B2C sales by rate, credit notes and the HSN summary",
        "Prepare the GSTR-3B summary: output tax by rate, eligible input credit, tax payable",
        "File GSTR-1, then pay and file GSTR-3B",
        "Keep the exported summaries with the month’s records",
      ] },
      { h2: "Where pharmacies usually go wrong" },
      { ul: ["Purchases entered weeks late, so input credit is missed or claimed in the wrong month", "Sales returns handled as cash refunds without a credit note", "Rate changes not updated in the item master", "Rounding differences between bills and the return because the bills were rewritten in Excel"] },
      { p: "The last point is the biggest time sink. If your billing software stores the taxable value and tax split on every bill, the return figures come straight from the bills and there is nothing to reconcile by hand." },
      { h2: "Make month-end a non-event" },
      { p: "[Pharmacy accounting software](/pharmacy-accounting-software) that posts every sale and purchase as it happens has the GSTR-1 and GSTR-3B summaries ready on the 1st, with exports your CA can use directly. To understand the rates on your bills, read [GST on medicines in India](/blog/gst-on-medicines-india)." },
    ],
  },
  {
    slug: "schedule-h-h1-x-rules-pharmacy",
    title: "Schedule H, H1 and X Drugs: What a Medical Store Must Record",
    description: "A plain guide to Schedule H, H1 and X medicines for Indian pharmacies: prescription rules, the H1 register, what to record and how long to keep it.",
    published: "2026-11-15", updated: "2026-11-15", minutes: 6,
    cta: { href: "/pharmacy-billing-software", text: "See prescription capture in Medoro billing" },
    body: [
      { note: "This is a general guide, not legal advice. The schedules and rules are amended from time to time. Check the current Drugs Rules and your state drug control department for the exact requirements." },
      { h2: "Why the schedules matter" },
      { p: "Under the Drugs and Cosmetics Rules, 1945, many medicines can be sold only on a prescription from a registered medical practitioner. Schedules H, H1 and X set out which medicines these are and what the pharmacist must do when selling them. Inspectors check these records, and gaps can lead to action against your licence." },
      { h2: "Schedule H" },
      { p: "Schedule H medicines are prescription-only. The label carries the Rx symbol and a warning that the medicine is to be sold by retail on the prescription of a registered medical practitioner only. Sell them only against a valid prescription, and keep sale records as your licence conditions require." },
      { h2: "Schedule H1" },
      { p: "Schedule H1 was introduced in 2013 for medicines that need closer control, including certain antibiotics, anti-TB drugs and habit-forming medicines. The label carries the Rx symbol in red with a boxed warning." },
      { p: "For every sale of a Schedule H1 medicine, the pharmacist must record the following in a separate register at the time of supply:" },
      { ul: ["Name and address of the prescriber", "Name of the patient", "Name of the medicine", "Quantity supplied"] },
      { p: "These records must be kept for three years and be open to inspection." },
      { h2: "Schedule X" },
      { p: "Schedule X covers medicines with a high risk of abuse, such as certain psychotropic substances. The rules are the strictest: the prescription is needed in duplicate and the pharmacy keeps a copy, the stock must be stored securely, and separate records of purchase and sale must be kept for the period the rules set." },
      { h2: "Good practice at the counter" },
      { ul: ["Make the bill ask for prescriber details automatically when an H1 item is added, so it cannot be skipped on a busy evening", "Keep a list of regular doctors so their details are picked, not typed", "Check the prescription date and that the quantity matches", "Print or export the H1 register for any date range when an inspector asks"] },
      { h2: "How billing software helps" },
      { p: "In [pharmacy billing software](/pharmacy-billing-software) like Medoro, Schedule H and H1 items ask for the prescriber before the bill closes, and the details are stored with the sale. That gives you the register you need without a separate notebook that someone forgets to fill in." },
    ],
  },
  {
    slug: "fefo-vs-fifo-pharmacy",
    title: "FEFO vs FIFO: Which Stock Method Should a Pharmacy Use?",
    description: "FIFO sells the oldest stock first; FEFO sells the earliest expiry first. Why FEFO is the right method for medical stores, with examples and how to apply it.",
    published: "2026-11-15", updated: "2026-11-15", minutes: 4,
    cta: { href: "/pharmacy-billing-software", text: "See FEFO billing in Medoro" },
    body: [
      { h2: "The difference in one line" },
      { p: "FIFO (First In, First Out) sells the stock that arrived first. FEFO (First Expiry, First Out) sells the stock that expires first. Most of the time these are the same batch, but not always, and the exceptions are where pharmacies lose money." },
      { h2: "An example" },
      { p: "In March you receive batch A of a syrup, expiring in December. In April a different distributor sends batch B of the same syrup, expiring in October, because it was older stock in their godown. FIFO sells batch A first, because it came in first. Batch B sits on the shelf and expires in October. FEFO sells batch B first, because it expires first, and both batches sell before they expire." },
      { h2: "Why FEFO is right for medicines" },
      { ul: ["Medicines have a hard expiry date; once it passes, the stock cannot be sold", "Distributors often send batches with different remaining shelf life", "Returns and exchanges bring older batches back into stock"] },
      { h2: "How to apply FEFO in a busy store" },
      { ol: ["Record batch and expiry for every line when you receive stock", "Arrange racks so the earliest expiry is in front", "Let the billing software pick the batch, rather than staff choosing by hand", "Block expired or recalled batches from being billed", "Review a 90-day expiry list weekly"] },
      { p: "The third step is what makes FEFO work in practice. When the bill picks the earliest-expiring batch automatically, nobody has to remember. Learn more steps in [how to reduce expiry loss](/blog/reduce-expiry-loss-medical-store), or see how [Medoro billing](/pharmacy-billing-software) applies FEFO on every line." },
    ],
  },
  {
    slug: "choose-pharmacy-billing-software",
    title: "How to Choose Pharmacy Billing Software: A 12-Point Checklist",
    description: "Choosing billing software for your medical store? A 12-point checklist covering speed, batch and expiry, GST, Schedule H1, offline billing, backups, data export and cost.",
    published: "2026-11-15", updated: "2026-11-15", minutes: 6,
    cta: { href: "/medical-store-software", text: "See how Medoro covers the checklist" },
    body: [
      { p: "Pharmacy billing software is something you will use hundreds of times a day for years. Switching later is a hassle, so it is worth checking a few things before you choose. Here is a checklist we would use if we were buying for our own store." },
      { h2: "At the counter" },
      { ol: [
        "Speed: can you bill a common medicine in a few keystrokes, without touching the mouse? Ask for a live demo on a busy-hour scenario.",
        "Search: does it find medicines by brand, salt (generic name) and barcode?",
        "Batch and expiry: does it pick the earliest-expiring batch automatically and block expired stock?",
        "Prescription rules: does it ask for prescriber details on Schedule H and H1 items before the bill closes?",
        "Payments: cash, UPI, card, split payments and customer credit with limits?",
      ] },
      { h2: "In the back office" },
      { ol: [
        "Purchases: can you import the distributor’s bill instead of typing every line, and does it check your total against the printed bill?",
        "Expiry and reorder: does it show what expires in the next 90 days and what needs reordering based on recent sales?",
        "GST and accounts: are GSTR-1 and GSTR-3B summaries ready at month-end, with exports your CA can use (Tally, Excel)?",
      ] },
      { h2: "Reliability and your data" },
      { ol: [
        "Offline: does billing continue when the internet goes down?",
        "Backups: are backups automatic, encrypted and stored somewhere you control, and has a restore ever been tested?",
        "Export: can you take all your data out, in a usable format, whenever you want? If not, you are locked in.",
        "Support and cost: is there real support in your language and working hours, and is the full yearly cost clear, including setup, extra counters and branches?",
      ] },
      { h2: "Questions to ask in the demo" },
      { ul: ["Show me a bill for a Schedule H1 medicine from start to finish", "Show me what expires in the next 90 days and what it will cost me", "Turn off the internet and bill", "Show me how I export everything if I leave", "How do I move my current stock and customers in?"] },
      { h2: "Try before you buy" },
      { p: "A free trial with your own stock tells you more than any brochure. Medoro offers a 7-day free trial with no card, imports your stock from Excel, and covers every point on this list. See [medical store software](/medical-store-software) for the full picture, or compare plans on the [pricing section](/#pricing)." },
    ],
  },
];

export const post = (slug: string) => POSTS.find((p) => p.slug === slug);
