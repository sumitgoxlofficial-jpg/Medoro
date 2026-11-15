/**
 * Blog articles (/blog/[slug]): practical guides for Indian pharmacy owners. Rules:
 * - Regulatory and tax statements stay at what the rule says and point readers to their CA or State Drugs Control
 *   office for their own case. Anything about Medoro follows the same rule as the feature pages: only what it does today.
 * - Inline text supports [link text](/path) and **bold**. Link to tools, features and other articles where they help
 *   the reader; src/data/seo-data.test.ts checks every internal link points at a real page.
 * - `updated` changes when the substance of an article changes, not for typo fixes.
 *
 * Adding an article: add it to POSTS (newest first is not required; the blog sorts by date).
 */
import type { ToolSlug } from "./tools";

export type Block =
  | { h2: string }
  | { h3: string }
  | { p: string }
  | { ul: string[] }
  | { ol: string[] }
  | { note: string }
  | { table: { caption: string; head: string[]; rows: string[][] } };

export type Post = {
  slug: string;
  title: string;
  description: string;
  keywords: string[];
  category: "Pricing & margins" | "Compliance" | "Stock & expiry" | "GST" | "Starting a pharmacy" | "Software";
  /** ISO dates. */
  published: string;
  updated?: string;
  h1: string;
  /** Opening paragraph, shown under the title and on the blog index. */
  lede: string;
  body: Block[];
  /** Optional FAQ, shown on the page and marked up as FAQPage. */
  faq?: [q: string, a: string][];
  tools: ToolSlug[];
  features: string[];
};

export const POSTS: Post[] = [
  // Published on medoro.in first (keep these slugs: they may already be indexed).
  {
    "slug": "reduce-expiry-loss-medical-store",
    "title": "How to Reduce Expiry Loss in a Medical Store: 8 Practical Steps",
    "description": "Expired medicines quietly eat a pharmacy’s margin. Eight practical steps to cut expiry loss: FEFO, 90-day reviews, distributor returns, smarter ordering and more.",
    "keywords": [
      "reduce expiry loss medical store",
      "near expiry medicines",
      "expiry management pharmacy",
      "expired medicine return to distributor"
    ],
    "category": "Stock & expiry",
    "published": "2026-11-15",
    "h1": "How to Reduce Expiry Loss in a Medical Store: 8 Practical Steps",
    "lede": "Ask any medical store owner where money disappears and expired stock is near the top of the list. A strip that expires on the shelf is a full loss at cost, and in a busy store those strips add up to thousands of rupees every month. The good news is that most expiry loss is preventable. It comes from a few habits that are easy to fix.",
    "body": [
      {
        "h2": "1. Sell the earliest expiry first (FEFO)"
      },
      {
        "p": "FEFO means First Expiry, First Out: whenever you sell a medicine, the batch that expires soonest goes first. It sounds obvious, but at a busy counter the staff pick whatever strip is at the front of the rack. If a newer batch was stacked in front of an older one, the older one sits until it expires. Read more in our guide to [FEFO vs FIFO](/blog/fefo-vs-fifo-pharmacy)."
      },
      {
        "ul": [
          "Arrange racks so older batches are in front",
          "Pick the batch on the bill, not by hand, so the system chooses the earliest expiry",
          "Block expired batches from being billed at all"
        ]
      },
      {
        "h2": "2. Review a 90-day expiry list every week"
      },
      {
        "p": "Most distributors accept near-expiry returns only within a window, often a few months before expiry. If you find out about a batch in the month it expires, it is already too late. Keep a list of every batch expiring in the next 90 days and look at it once a week. For each batch, decide: will it sell in time, or does it need action?"
      },
      {
        "h2": "3. Know the loss in rupees, not just the quantity"
      },
      {
        "p": "Ten strips of a cheap antacid and ten strips of an expensive biologic are not the same problem. Value every near-expiry batch at cost and sort by the loss. Start with the batches that would cost you the most. This turns a long, boring list into three or four decisions that matter."
      },
      {
        "h2": "4. Return to the distributor while you still can"
      },
      {
        "p": "Find out each distributor’s return policy for near-expiry stock: how many months before expiry they accept returns, and whether they give credit or replacement. Note it against the supplier. When a batch enters the return window and is unlikely to sell, send it back instead of waiting."
      },
      {
        "h2": "5. Move stock between branches"
      },
      {
        "p": "If you run more than one store, a medicine that sells slowly in one branch may sell well in another. Transfer near-expiry stock to the branch where it moves fastest, with a proper transfer record so both branches’ stock stays correct."
      },
      {
        "h2": "6. Order by sales, not by habit"
      },
      {
        "p": "Overstocking is the root of most expiry. Instead of reordering the same quantity every time, look at how much actually sold in the last four weeks and set a reorder level from that. Slow movers should be bought in smaller quantities, more often."
      },
      {
        "ul": [
          "Set a reorder level for each item based on recent sales",
          "Be careful with schemes like ‘10+1 free’ on slow-moving items: the free strip is not free if it expires",
          "Check the expiry date on the distributor’s bill before you accept the delivery"
        ]
      },
      {
        "h2": "7. Tell regular customers"
      },
      {
        "p": "Patients on long-term medicines buy the same thing every month. If you have stock of their medicine that needs to move, a refill reminder brings them back before it expires, and they get their medicine on time."
      },
      {
        "h2": "8. Count stock regularly"
      },
      {
        "p": "Expiry lists are only as good as your stock records. If the system says you have two strips and the rack has twelve, the problem stays hidden. Do a short cycle count of a few racks each week, rather than one painful full count a year."
      },
      {
        "h2": "How software helps"
      },
      {
        "p": "Doing all of this on paper is possible but slow. Good [pharmacy inventory software](/pharmacy-inventory-software) picks the earliest batch on every bill, lists what expires in the next 30, 60, 90 or 180 days with the loss at cost, and suggests whether to return, transfer or push each batch. It turns expiry from a monthly surprise into a weekly ten-minute review."
      }
    ],
    "tools": [
      "pharma-margin-calculator"
    ],
    "features": [
      "expiry-management",
      "inventory-management"
    ]
  },
  {
    "slug": "gst-on-medicines-india",
    "title": "GST on Medicines in India (2026): Rates, HSN and Billing at MRP",
    "description": "GST rates on medicines after the September 2025 cut, how to work out GST from the MRP on a pharmacy bill, HSN codes, and common mistakes medical stores make.",
    "keywords": [
      "gst on medicines",
      "gst rate on medicines 2026",
      "medicine hsn code gst",
      "gst on mrp calculation"
    ],
    "category": "GST",
    "published": "2026-11-15",
    "h1": "GST on Medicines in India (2026): Rates, HSN and Billing at MRP",
    "lede": "GST rates on medicines after the September 2025 cut, how to work out GST from the MRP on a pharmacy bill, HSN codes, and common mistakes medical stores make.",
    "body": [
      {
        "note": "This is a general guide for medical store owners, not tax advice. Rates can change by notification: check the current rate for each product with your CA or on the CBIC website."
      },
      {
        "h2": "GST rates on medicines after September 2025"
      },
      {
        "p": "On 22 September 2025, the GST rate on most medicines came down from 12% to 5% as part of the GST rate rationalisation. A list of life-saving drugs, including several cancer and rare-disease medicines, moved to nil GST. Some products sold in pharmacies that are not medicines, such as many cosmetics and personal-care items, are taxed at their own rates, often 18%."
      },
      {
        "ul": [
          "Most medicines (HSN 3003 and 3004): 5%",
          "Notified life-saving drugs: nil",
          "Non-medicine items in the store: as per their own HSN, check each one"
        ]
      },
      {
        "p": "Because the rate changed, your item master must carry the correct rate for each product. A store that still bills at the old 12% rate on medicines charges customers the wrong amount and reports the wrong tax."
      },
      {
        "h2": "How GST is calculated when you sell at MRP"
      },
      {
        "p": "Medicines are sold at MRP, and the MRP already includes GST. So the bill must work backwards from the MRP to find the taxable value and the tax. The formula is:"
      },
      {
        "p": "Taxable value = Selling price ÷ (1 + GST rate). Tax = Selling price − Taxable value."
      },
      {
        "p": "Example: a medicine with an MRP of ₹105 at 5% GST. Taxable value = 105 ÷ 1.05 = ₹100. Tax = ₹5. For a sale within your state, that is split into CGST ₹2.50 and SGST ₹2.50. For a sale to a business in another state, it is IGST ₹5."
      },
      {
        "p": "If you give a discount, apply it to the selling price first and then work out the taxable value from the discounted price."
      },
      {
        "h2": "HSN codes pharmacies use most"
      },
      {
        "ul": [
          "3004: medicaments in measured doses or packed for retail sale (most tablets, capsules, syrups, injections)",
          "3003: medicaments not in measured doses",
          "3005: bandages, dressings and similar",
          "3006: certain pharmaceutical goods such as sterile sutures and first-aid kits"
        ]
      },
      {
        "p": "Your bills must show the HSN code at the level your turnover requires. Keep it in the item master so it prints on every bill automatically."
      },
      {
        "h2": "Purchases and input tax credit"
      },
      {
        "p": "The GST on your distributor’s bill is your input tax. You claim it as credit against the GST you collect on sales, as long as the distributor has reported the invoice in their GSTR-1. Record purchases with the correct rate and the distributor’s GSTIN, and check them against your GSTR-2B every month."
      },
      {
        "h2": "Common GST mistakes in medical stores"
      },
      {
        "ul": [
          "Wrong rate in the item master after a rate change",
          "Adding GST on top of MRP instead of working it out from MRP",
          "Not issuing credit notes for sales returns, so tax is overpaid",
          "Missing the buyer’s GSTIN on B2B bills to clinics and hospitals",
          "Entering purchases late, so input credit does not match GSTR-2B"
        ]
      },
      {
        "h2": "Let the software do the maths"
      },
      {
        "p": "[GST billing software for pharmacy](/gst-billing-software-for-pharmacy) works out the taxable value from MRP on every line, splits CGST and SGST or IGST, prints the HSN code and keeps output and input tax by slab, so your month-end summaries are ready without a spreadsheet. See also our [GSTR-1 and GSTR-3B checklist for pharmacies](/blog/gst-returns-for-pharmacy)."
      }
    ],
    "tools": [
      "medicine-hsn-code-finder",
      "free-pharmacy-invoice-generator"
    ],
    "features": [
      "gst-billing"
    ]
  },
  {
    "slug": "gst-returns-for-pharmacy",
    "title": "GSTR-1 and GSTR-3B for Pharmacies: A Monthly Checklist",
    "description": "A simple monthly GST checklist for medical stores: what goes into GSTR-1 and GSTR-3B, due dates, QRMP, input credit checks and how to avoid late fees.",
    "keywords": [
      "gstr-1 for pharmacy",
      "gstr-3b pharmacy",
      "gst return checklist medical store",
      "hsn summary gstr-1"
    ],
    "category": "GST",
    "published": "2026-11-15",
    "h1": "GSTR-1 and GSTR-3B for Pharmacies: A Monthly Checklist",
    "lede": "A simple monthly GST checklist for medical stores: what goes into GSTR-1 and GSTR-3B, due dates, QRMP, input credit checks and how to avoid late fees.",
    "body": [
      {
        "note": "Due dates and rules can change by notification. Confirm the current dates on the GST portal or with your CA before filing."
      },
      {
        "h2": "The two returns most pharmacies file"
      },
      {
        "p": "A regular GST-registered medical store files two main returns. GSTR-1 reports your sales. GSTR-3B is the summary return where you pay the tax: GST collected on sales minus the input credit from purchases."
      },
      {
        "h2": "Due dates"
      },
      {
        "ul": [
          "Monthly filers: GSTR-1 by the 11th and GSTR-3B by the 20th of the next month",
          "QRMP scheme (turnover up to ₹5 crore, if you opt in): GSTR-1 and GSTR-3B quarterly, with tax paid monthly by the 25th using PMT-06",
          "Late GSTR-3B attracts a late fee per day plus interest on unpaid tax, so file on time even if the amount is small"
        ]
      },
      {
        "h2": "Monthly checklist"
      },
      {
        "ol": [
          "Close the month’s billing: no held or draft bills left open",
          "Enter every distributor bill received in the month, with GSTIN, invoice number, rate and tax",
          "Issue credit notes for every sales return and debit notes for purchase returns",
          "Check B2B bills carry the buyer’s GSTIN and correct place of supply",
          "Download GSTR-2B and match it with your purchase register; follow up with distributors whose invoices are missing",
          "Prepare the GSTR-1 summary: B2B invoices, B2C sales by rate, credit notes and the HSN summary",
          "Prepare the GSTR-3B summary: output tax by rate, eligible input credit, tax payable",
          "File GSTR-1, then pay and file GSTR-3B",
          "Keep the exported summaries with the month’s records"
        ]
      },
      {
        "h2": "Where pharmacies usually go wrong"
      },
      {
        "ul": [
          "Purchases entered weeks late, so input credit is missed or claimed in the wrong month",
          "Sales returns handled as cash refunds without a credit note",
          "Rate changes not updated in the item master",
          "Rounding differences between bills and the return because the bills were rewritten in Excel"
        ]
      },
      {
        "p": "The last point is the biggest time sink. If your billing software stores the taxable value and tax split on every bill, the return figures come straight from the bills and there is nothing to reconcile by hand."
      },
      {
        "h2": "Make month-end a non-event"
      },
      {
        "p": "[Pharmacy accounting software](/pharmacy-accounting-software) that posts every sale and purchase as it happens has the GSTR-1 and GSTR-3B summaries ready on the 1st, with exports your CA can use directly. To understand the rates on your bills, read [GST on medicines in India](/blog/gst-on-medicines-india)."
      }
    ],
    "tools": [
      "medicine-hsn-code-finder"
    ],
    "features": [
      "gst-billing"
    ]
  },
  {
    "slug": "schedule-h-h1-x-rules-pharmacy",
    "title": "Schedule H, H1 and X Drugs: What a Medical Store Must Record",
    "description": "A plain guide to Schedule H, H1 and X medicines for Indian pharmacies: prescription rules, the H1 register, what to record and how long to keep it.",
    "keywords": [
      "schedule h1 register",
      "schedule h h1 x drugs",
      "schedule h1 drugs list",
      "prescription register pharmacy",
      "schedule h1 register format"
    ],
    "category": "Compliance",
    "published": "2026-11-15",
    "h1": "Schedule H, H1 and X Drugs: What a Medical Store Must Record",
    "lede": "A plain guide to Schedule H, H1 and X medicines for Indian pharmacies: prescription rules, the H1 register, what to record and how long to keep it.",
    "body": [
      {
        "note": "This is a general guide, not legal advice. The schedules and rules are amended from time to time. Check the current Drugs Rules and your state drug control department for the exact requirements."
      },
      {
        "h2": "Why the schedules matter"
      },
      {
        "p": "Under the Drugs and Cosmetics Rules, 1945, many medicines can be sold only on a prescription from a registered medical practitioner. Schedules H, H1 and X set out which medicines these are and what the pharmacist must do when selling them. Inspectors check these records, and gaps can lead to action against your licence."
      },
      {
        "h2": "Schedule H"
      },
      {
        "p": "Schedule H medicines are prescription-only. The label carries the Rx symbol and a warning that the medicine is to be sold by retail on the prescription of a registered medical practitioner only. Sell them only against a valid prescription, and keep sale records as your licence conditions require."
      },
      {
        "h2": "Schedule H1"
      },
      {
        "p": "Schedule H1 was introduced in 2013, in force from March 2014, for medicines that need closer control. The original list has 46 drugs, mainly:"
      },
      {
        "ul": [
          "Newer antibiotics, such as several third- and fourth-generation cephalosporins (for example cefixime, cefpodoxime and ceftriaxone), carbapenems and newer fluoroquinolones (for example levofloxacin and moxifloxacin)",
          "Anti-tuberculosis drugs such as isoniazid, rifampicin, ethambutol and pyrazinamide",
          "Habit-forming drugs such as alprazolam, diazepam, zolpidem, tramadol and codeine"
        ]
      },
      {
        "p": "The list can be amended by notification, so check the current one rather than relying on a printed chart."
      },
      {
        "p": "To recognise an H1 pack, look for the **Rx symbol in red** and a boxed warning stating that it is dangerous to take the preparation except in accordance with medical advice, and that it must not be sold by retail without the prescription of a Registered Medical Practitioner."
      },
      {
        "p": "For every sale of a Schedule H1 medicine, the pharmacist must record the following in a separate register at the time of supply:"
      },
      {
        "ul": [
          "Name and address of the prescriber",
          "Name of the patient",
          "Name of the medicine",
          "Quantity supplied"
        ]
      },
      {
        "p": "Most pharmacies also note the date, invoice number and batch number. They aren't in the list above, but they make it much easier to trace a sale during a recall or answer an inspector's question."
      },
      {
        "table": {
          "caption": "A practical Schedule H1 register layout",
          "head": ["Date", "Invoice", "Patient", "Prescriber (name, address)", "Medicine", "Batch", "Qty"],
          "rows": [
            ["14/11/2026", "INV/0412", "Ramesh Kumar", "Dr. A. Sinha, Sector 4, Bokaro", "Cefixime 200 mg tablets", "CF2231", "10"]
          ]
        }
      },
      {
        "p": "These records must be kept for three years and be open to inspection."
      },
      {
        "h2": "Schedule X"
      },
      {
        "p": "Schedule X covers medicines with a high risk of abuse, such as certain psychotropic substances. The rules are the strictest: the prescription is needed in duplicate and the pharmacy keeps a copy, the stock must be stored securely, and separate records of purchase and sale must be kept for the period the rules set."
      },
      {
        "h2": "Schedule H, H1 and X at a glance"
      },
      {
        "table": {
          "caption": "Prescription schedules compared",
          "head": ["Schedule", "Sold on", "Extra record keeping"],
          "rows": [
            ["H", "Prescription of a Registered Medical Practitioner", "Sale records as your licence conditions require"],
            ["H1", "Prescription", "Separate H1 register: prescriber, patient, medicine, quantity; kept 3 years"],
            ["X", "Prescription in duplicate, under a separate licence (Form 20-F)", "Copy of the prescription kept, separate purchase and sale records, secure storage"]
          ]
        }
      },
      {
        "h2": "Good practice at the counter"
      },
      {
        "ul": [
          "Make the bill ask for prescriber details automatically when an H1 item is added, so it cannot be skipped on a busy evening",
          "Keep a list of regular doctors so their details are picked, not typed",
          "Check the prescription date and that the quantity matches",
          "Print or export the H1 register for any date range when an inspector asks"
        ]
      },
      {
        "h2": "How billing software helps"
      },
      {
        "p": "In [pharmacy billing software](/pharmacy-billing-software) like Medoro, Schedule H and H1 items ask for the prescriber before the bill closes, and the details are stored with the sale. That gives you the register you need without a separate notebook that someone forgets to fill in: see how [Medoro's Schedule H1 register](/features/schedule-h1-compliance) builds it from your bills."
      }
    ],
    "faq": [
      ["Is a separate register compulsory for Schedule H1 drugs?", "Yes. The supply of a Schedule H1 drug has to be recorded in a separate register with the prescriber's name and address, the patient's name, the medicine and the quantity supplied."],
      ["How long should I keep the Schedule H1 register?", "Three years, open for inspection by the drug inspector."],
      ["Can the Schedule H1 register be kept on a computer?", "Many pharmacies keep it in software and print it when needed. Check with your State Drugs Control office whether they also expect a printed, signed register."],
      ["Is cefixime a Schedule H1 drug?", "Cefixime is on the original Schedule H1 list, along with several other cephalosporins. Check the current list, as it can be amended."]
    ],
    "tools": [
      "free-pharmacy-invoice-generator"
    ],
    "features": [
      "schedule-h1-compliance"
    ]
  },
  {
    "slug": "fefo-vs-fifo-pharmacy",
    "title": "FEFO vs FIFO: Which Stock Method Should a Pharmacy Use?",
    "description": "FIFO sells the oldest stock first; FEFO sells the earliest expiry first. Why FEFO is the right method for medical stores, with examples and how to apply it.",
    "keywords": [
      "fefo vs fifo",
      "fefo pharmacy",
      "first expiry first out",
      "stock rotation pharmacy"
    ],
    "category": "Stock & expiry",
    "published": "2026-11-15",
    "h1": "FEFO vs FIFO: Which Stock Method Should a Pharmacy Use?",
    "lede": "FIFO sells the oldest stock first; FEFO sells the earliest expiry first. Why FEFO is the right method for medical stores, with examples and how to apply it.",
    "body": [
      {
        "h2": "The difference in one line"
      },
      {
        "p": "FIFO (First In, First Out) sells the stock that arrived first. FEFO (First Expiry, First Out) sells the stock that expires first. Most of the time these are the same batch, but not always, and the exceptions are where pharmacies lose money."
      },
      {
        "h2": "An example"
      },
      {
        "p": "In March you receive batch A of a syrup, expiring in December. In April a different distributor sends batch B of the same syrup, expiring in October, because it was older stock in their godown. FIFO sells batch A first, because it came in first. Batch B sits on the shelf and expires in October. FEFO sells batch B first, because it expires first, and both batches sell before they expire."
      },
      {
        "h2": "Why FEFO is right for medicines"
      },
      {
        "ul": [
          "Medicines have a hard expiry date; once it passes, the stock cannot be sold",
          "Distributors often send batches with different remaining shelf life",
          "Returns and exchanges bring older batches back into stock"
        ]
      },
      {
        "h2": "How to apply FEFO in a busy store"
      },
      {
        "ol": [
          "Record batch and expiry for every line when you receive stock",
          "Arrange racks so the earliest expiry is in front",
          "Let the billing software pick the batch, rather than staff choosing by hand",
          "Block expired or recalled batches from being billed",
          "Review a 90-day expiry list weekly"
        ]
      },
      {
        "p": "The third step is what makes FEFO work in practice. When the bill picks the earliest-expiring batch automatically, nobody has to remember. Learn more steps in [how to reduce expiry loss](/blog/reduce-expiry-loss-medical-store), or see how [Medoro billing](/pharmacy-billing-software) applies FEFO on every line."
      }
    ],
    "tools": [],
    "features": [
      "expiry-management",
      "inventory-management"
    ]
  },
  {
    "slug": "choose-pharmacy-billing-software",
    "title": "How to Choose Pharmacy Billing Software: A 12-Point Checklist",
    "description": "Choosing billing software for your medical store? A 12-point checklist covering speed, batch and expiry, GST, Schedule H1, offline billing, backups, data export and cost.",
    "keywords": [
      "best pharmacy billing software",
      "how to choose pharmacy software",
      "medical store software checklist",
      "pharmacy software features"
    ],
    "category": "Software",
    "published": "2026-11-15",
    "h1": "How to Choose Pharmacy Billing Software: A 12-Point Checklist",
    "lede": "Pharmacy billing software is something you will use hundreds of times a day for years. Switching later is a hassle, so it is worth checking a few things before you choose. Here is a checklist we would use if we were buying for our own store.",
    "body": [
      {
        "h2": "At the counter"
      },
      {
        "ol": [
          "Speed: can you bill a common medicine in a few keystrokes, without touching the mouse? Ask for a live demo on a busy-hour scenario.",
          "Search: does it find medicines by brand, salt (generic name) and barcode?",
          "Batch and expiry: does it pick the earliest-expiring batch automatically and block expired stock?",
          "Prescription rules: does it ask for prescriber details on Schedule H and H1 items before the bill closes?",
          "Payments: cash, UPI, card, split payments and customer credit with limits?"
        ]
      },
      {
        "h2": "In the back office"
      },
      {
        "ol": [
          "Purchases: can you import the distributor’s bill instead of typing every line, and does it check your total against the printed bill?",
          "Expiry and reorder: does it show what expires in the next 90 days and what needs reordering based on recent sales?",
          "GST and accounts: are GSTR-1 and GSTR-3B summaries ready at month-end, with exports your CA can use (Tally, Excel)?"
        ]
      },
      {
        "h2": "Reliability and your data"
      },
      {
        "ol": [
          "Offline: does billing continue when the internet goes down?",
          "Backups: are backups automatic, encrypted and stored somewhere you control, and has a restore ever been tested?",
          "Export: can you take all your data out, in a usable format, whenever you want? If not, you are locked in.",
          "Support and cost: is there real support in your language and working hours, and is the full yearly cost clear, including setup, extra counters and branches?"
        ]
      },
      {
        "h2": "Questions to ask in the demo"
      },
      {
        "ul": [
          "Show me a bill for a Schedule H1 medicine from start to finish",
          "Show me what expires in the next 90 days and what it will cost me",
          "Turn off the internet and bill",
          "Show me how I export everything if I leave",
          "How do I move my current stock and customers in?"
        ]
      },
      {
        "h2": "Try before you buy"
      },
      {
        "p": "A free trial with your own stock tells you more than any brochure. Medoro offers a 7-day free trial with no card, imports your stock from Excel, and covers every point on this list. See [medical store software](/medical-store-software) for the full picture, or compare plans on the [pricing section](/#pricing)."
      }
    ],
    "tools": [
      "pharma-margin-calculator",
      "medicine-hsn-code-finder"
    ],
    "features": [
      "gst-billing",
      "expiry-management",
      "ai-invoice-scanner"
    ]
  },
  // Pricing and starting-a-pharmacy guides.
  {
    slug: "how-to-calculate-ptr-pts-from-mrp",
    title: "How to Calculate PTR and PTS from MRP (with Examples)",
    description: "PTR and PTS explained for chemists: how to work them out from MRP and GST, margin vs markup, worked examples at 5% and 12%, and how schemes change real cost.",
    keywords: ["how to calculate ptr from mrp", "ptr pts meaning", "ptr calculation formula", "pts in pharma", "retailer margin on medicines"],
    category: "Pricing & margins",
    published: "2026-11-15",
    h1: "How to calculate PTR and PTS from MRP",
    lede: "Every distributor bill shows MRP and PTR, and every stockist talks about PTS. Here is what each one means, how to work them out from the MRP printed on the strip, and why the answer depends on whether your distributor quotes margin or markup.",
    body: [
      { h2: "MRP, PTR and PTS in one line each" },
      { ul: [
        "**MRP (Maximum Retail Price)** is the price printed on the pack. It includes GST, and you can't sell above it.",
        "**PTR (Price to Retailer)** is what the distributor charges you, the retailer, before GST.",
        "**PTS (Price to Stockist)** is what the company or its C&F agent charges the stockist, before GST. The gap between PTS and PTR is the stockist's margin.",
      ] },
      { p: "So the chain runs company → stockist (pays PTS) → retailer (pays PTR) → patient (pays MRP). Each step adds a margin, and GST is charged at each step but credited back to registered businesses, so it doesn't stack up." },
      { h2: "Step 1: take GST out of the MRP" },
      { p: "Because MRP includes GST, start from the price without tax: **MRP without GST = MRP ÷ (1 + GST rate)**. For a strip with MRP ₹105 at 5% GST, that is ₹105 ÷ 1.05 = ₹100. At 12% it would be ₹105 ÷ 1.12 = ₹93.75." },
      { h2: "Step 2: take off the retailer margin" },
      { p: "Here is where most confusion comes from. A \"20% margin\" can mean two different things:" },
      { table: { caption: "Two ways to apply a 20% retailer margin to ₹100 (MRP without GST)", head: ["Method", "Formula", "PTR", "Your profit"], rows: [
        ["Margin on selling price", "₹100 × (1 − 0.20)", "₹80.00", "₹20 (20% of the selling price)"],
        ["Markup on cost", "₹100 ÷ (1 + 0.20)", "₹83.33", "₹16.67 (20% of the PTR)"],
      ] } },
      { p: "In Indian pharma trade, margins are usually quoted on the selling price, so the first line is the common one. If your distributor's numbers don't match yours, ask which method they use." },
      { h2: "Step 3: take off the stockist margin to get PTS" },
      { p: "Apply the stockist's margin to the PTR the same way. With a 10% stockist margin on the selling price: PTS = ₹80 × (1 − 0.10) = ₹72. The stockist earns ₹8 a strip." },
      { h2: "Why your profit is worked out without GST" },
      { p: "You pay 5% GST on the PTR (₹4 on ₹80) and collect 5% on the sale (₹5 on ₹100). The ₹4 you paid is input tax credit, so only the ₹1 difference goes to the government. Your real profit per strip is ₹100 − ₹80 = **₹20**, not ₹105 − ₹84." },
      { table: { caption: "One strip, MRP ₹105, 5% GST, 20% retailer and 10% stockist margin", head: ["Line", "Amount"], rows: [
        ["MRP (with GST)", "₹105.00"], ["MRP without GST", "₹100.00"], ["PTR", "₹80.00"], ["PTR with GST (what you pay)", "₹84.00"], ["PTS", "₹72.00"], ["Your profit", "₹20.00"], ["Net GST you pay", "₹1.00"],
      ] } },
      { h2: "What changes your real cost" },
      { p: "PTR is the starting point, not your real cost. Distributor bills also carry:" },
      { ul: [
        "**Free goods (schemes)** such as \"10+1\": you pay for 10 and get 11, so the cost per strip drops by about 9%.",
        "**Trade discount** and **cash discount** percentages on the line or the bill.",
        "**Price-controlled medicines**: for scheduled formulations under the DPCO, the NPPA notifies ceiling prices, which caps the MRP and so the margin available.",
      ] },
      { p: "The cost after all of these is your **landed cost**. Two strips with the same PTR can have very different landed costs depending on the scheme." },
      { note: "Try your own numbers in the free [PTR, PTS and margin calculator](/tools/pharma-margin-calculator). It shows both methods, the GST split and totals for an order." },
      { h2: "Doing this for every purchase" },
      { p: "Working out landed cost by hand for a 60-line distributor bill isn't realistic. Pharmacy software that imports the distributor's e-bill can read PTR, PTS, free quantity and discounts from each line and show the margin as you check the bill. See how [Medoro's purchase bill import](/features/ai-invoice-scanner) does it." },
    ],
    faq: [
      ["What is the formula for PTR from MRP?", "With the usual margin-on-selling-price method, PTR = MRP ÷ (1 + GST rate) × (1 − retailer margin). For MRP ₹105 at 5% GST and a 20% margin, PTR = ₹100 × 0.80 = ₹80."],
      ["Is PTR inclusive of GST?", "No. PTR is quoted before GST. The distributor adds GST on top of the PTR on the bill."],
      ["What is the difference between PTR and PTS?", "PTR is the price to the retailer and PTS the price to the stockist. The difference is the stockist's margin."],
      ["How much margin does a chemist get on medicines?", "It varies by product. Branded medicines often carry around 20% to 30% for the retailer, trade generics usually more, and price-controlled formulations less. Check the PTR and MRP on your own bills."],
    ],
    tools: ["pharma-margin-calculator"],
    features: ["ai-invoice-scanner", "inventory-management"],
  },
  {
    slug: "how-to-start-a-medical-store-in-india",
    title: "How to Start a Medical Store in India: Licences Checklist",
    description: "Checklist for opening a medical store in India: retail drug licence (Forms 20 and 21), registered pharmacist, premises, GST registration and local licences.",
    keywords: ["how to start a medical store in india", "drug licence for medical store", "pharmacy licence requirements india", "retail drug licence form 20 21", "medical shop licence"],
    category: "Starting a pharmacy",
    published: "2026-11-15",
    h1: "How to start a medical store in India: a licences checklist",
    lede: "Opening a medical store takes more paperwork than most shops. Here are the licences and registrations you will need, the order to get them in, and what to set up before your first sale.",
    body: [
      { note: "Requirements and fees vary by state and change over time. Use this as a checklist, and confirm the details with your State Drugs Control office before you apply." },
      { h2: "1. A registered pharmacist" },
      { p: "A retail drug licence is issued only if the sale of medicines will be carried out under the supervision of a pharmacist registered under the Pharmacy Act, 1948. Either you are one, or you employ one who will be present while the shop is open. Their registration certificate is part of the application." },
      { h2: "2. Suitable premises" },
      { p: "The drug controller inspects the premises before granting the licence. Commonly checked points include:" },
      { ul: [
        "Minimum floor area (commonly 10 square metres for a retail medical store, more if you also sell wholesale)",
        "Proof of ownership or a rent agreement",
        "Proper storage, including a refrigerator for medicines that must be kept cold",
        "A shop that is clean, dry and protected from direct sunlight",
      ] },
      { h2: "3. The retail drug licence" },
      { p: "Apply to your State Drugs Control office (most states accept online applications). Retail licences are granted in:" },
      { table: { caption: "Retail drug licences", head: ["Form", "Covers"], rows: [
        ["Form 20", "Retail sale of drugs other than those in Schedules C, C(1) and X"],
        ["Form 21", "Retail sale of drugs in Schedules C and C(1) (such as biologicals), excluding Schedule X"],
        ["Form 20-F", "Retail sale of Schedule X drugs, if you need to sell them"],
      ] } },
      { p: "Most medical stores hold both 20 and 21. Wholesale licences are separate (Forms 20B and 21B)." },
      { h2: "4. GST registration" },
      { p: "Register for GST if your turnover will cross the threshold for your state, or earlier if you want to claim input tax credit on purchases and issue tax invoices to clinics and hospitals. Distributors usually ask for your GSTIN and drug licence numbers before supplying." },
      { h2: "5. Local registrations" },
      { ul: [
        "Shop and establishment registration under your state's act",
        "Trade licence from the municipal body, where required",
        "Udyam registration (optional, but useful for MSME benefits)",
        "A current account in the shop's name for distributor payments",
      ] },
      { h2: "6. Before your first sale" },
      { ul: [
        "Open accounts with two or three distributors and agree their credit and return terms",
        "Set up your medicine master with HSN and GST rates (most medicines are 5% since September 2025; see the [HSN and GST finder](/tools/medicine-hsn-code-finder))",
        "Print your GSTIN and drug licence numbers on every bill",
        "Set up a Schedule H1 register (see our [guide to Schedule H, H1 and X records](/blog/schedule-h-h1-x-rules-pharmacy))",
        "Choose billing software that tracks batch and expiry from day one",
      ] },
      { note: "Starting fresh is the easiest time to set up software. [Medoro](/solutions/retail-pharmacy) starts at ₹999 a month for one store, with a 7-day free trial and no card needed." },
    ],
    faq: [
      ["Do I need to be a pharmacist to open a medical store?", "No, but the store needs a registered pharmacist who supervises sales and is present while it is open. Their registration is part of the drug licence application."],
      ["Which forms are needed for a retail drug licence?", "Retail licences are granted in Form 20 and Form 21, with Form 20-F for Schedule X drugs. Apply to your State Drugs Control office."],
      ["How much space do I need for a medical store?", "Commonly at least 10 square metres for a retail store, and more for a combined retail and wholesale business. Check your state's current requirement."],
      ["Is GST registration compulsory for a medical store?", "It depends on your turnover and your state's threshold, but most medical stores register so they can claim input tax credit and supply businesses."],
    ],
    tools: ["medicine-hsn-code-finder", "free-pharmacy-invoice-generator"],
    features: ["gst-billing", "schedule-h1-compliance"],
  },
];

/** Newest first. */
export const POSTS_BY_DATE = [...POSTS].sort((a, b) => (b.updated ?? b.published).localeCompare(a.updated ?? a.published) || a.title.localeCompare(b.title));
export const postBySlug = (slug: string) => POSTS.find((p) => p.slug === slug);

/** Plain text of an article's body, for word counts and reading time. */
export function postText(p: Post): string {
  const strip = (s: string) => s.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").replace(/\*\*/g, "");
  return [p.lede, ...p.body.flatMap((b) => {
    if ("p" in b) return [b.p];
    if ("note" in b) return [b.note];
    if ("h2" in b) return [b.h2];
    if ("h3" in b) return [b.h3];
    if ("ul" in b) return b.ul;
    if ("ol" in b) return b.ol;
    return [b.table.caption, ...b.table.head, ...b.table.rows.flat()];
  })].map(strip).join(" ");
}
/** "2026-11-15" → "15 November 2026". */
export const fmtDate = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
export const wordCount = (p: Post) => postText(p).split(/\s+/).filter(Boolean).length;
export const readingMinutes = (p: Post) => Math.max(1, Math.round(wordCount(p) / 200));

/** Internal links inside an article body, for tests. */
export const postLinks = (p: Post) => [...JSON.stringify(p.body).matchAll(/\]\((\/[^)]*)\)/g)].map((m) => m[1]);

/** Articles that mention a tool or feature, for "related reading" on those pages. */
export const postsForTool = (slug: ToolSlug) => POSTS_BY_DATE.filter((p) => p.tools.includes(slug));
export const postsForFeature = (slug: string) => POSTS_BY_DATE.filter((p) => p.features.includes(slug));
