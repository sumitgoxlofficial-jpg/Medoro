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
  faq: [q: string, a: string][];
  tools: ToolSlug[];
  features: string[];
};

export const POSTS: Post[] = [
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
    slug: "schedule-h1-register-guide",
    title: "Schedule H1 Register: What Chemists Must Record",
    description: "A plain guide to the Schedule H1 register for Indian pharmacies: which drugs it covers, what to record for each sale, how long to keep it and how to keep it current.",
    keywords: ["schedule h1 register format", "schedule h1 drugs list", "schedule h1 register rules", "h1 register in pharmacy", "schedule h vs h1"],
    category: "Compliance",
    published: "2026-11-15",
    h1: "The Schedule H1 register: what chemists must record",
    lede: "Schedule H1 was added to the Drugs and Cosmetics Rules to curb the over-the-counter sale of certain antibiotics, anti-TB drugs and habit-forming medicines. If you sell any of them, you need a separate register. Here is what goes in it and how to keep it without slowing the counter down.",
    body: [
      { note: "This guide summarises the rule for general understanding. It isn't legal advice: check the current rules and any state-specific instructions with your State Drugs Control office." },
      { h2: "What is Schedule H1?" },
      { p: "Schedule H1 is a list of prescription drugs under the Drugs and Cosmetics Rules, 1945, notified in 2013 and in force since March 2014. The original list has 46 drugs, mainly:" },
      { ul: [
        "Newer antibiotics, such as several third- and fourth-generation cephalosporins (for example cefixime, cefpodoxime and ceftriaxone), carbapenems and newer fluoroquinolones (for example levofloxacin and moxifloxacin)",
        "Anti-tuberculosis drugs such as isoniazid, rifampicin, ethambutol and pyrazinamide",
        "Habit-forming drugs such as alprazolam, diazepam, zolpidem, tramadol and codeine",
      ] },
      { p: "The list can change by notification, so check the current one rather than relying on a printed chart." },
      { h2: "How to recognise an H1 drug" },
      { p: "Packs of Schedule H1 drugs carry the symbol **Rx in red** and a boxed warning stating that the drug is dangerous to take except in accordance with medical advice and must not be sold by retail without the prescription of a Registered Medical Practitioner." },
      { h2: "What the register must contain" },
      { p: "The supply of a Schedule H1 drug has to be recorded in a separate register at the time of supply, with:" },
      { ol: ["The name and address of the prescriber", "The name of the patient", "The name of the drug", "The quantity supplied"] },
      { p: "Most pharmacies also note the date, invoice number and batch number. These aren't in the list above but make it much easier to trace a sale if there is a recall or an inspection question." },
      { table: { caption: "A practical Schedule H1 register layout", head: ["Date", "Invoice", "Patient", "Prescriber (name, address)", "Drug", "Batch", "Qty"], rows: [
        ["14/11/2026", "INV/0412", "Ramesh Kumar", "Dr. A. Sinha, Sector 4, Bokaro", "Cefixime 200 mg tablets", "CF2231", "10"],
      ] } },
      { h2: "How long to keep it" },
      { p: "The register must be kept for **three years** and be open for inspection by the drug inspector." },
      { h2: "Schedule H, H1 and X: how they differ" },
      { table: { caption: "Prescription schedules at a glance", head: ["Schedule", "Sold on", "Extra record keeping"], rows: [
        ["H", "Prescription of a Registered Medical Practitioner", "No separate register required by the H1 rule"],
        ["H1", "Prescription", "Separate H1 register: prescriber, patient, drug, quantity; kept 3 years"],
        ["X", "Prescription, under a separate licence (Form 20-F)", "Stricter records, including keeping a copy of the prescription"],
      ] } },
      { h2: "Keeping the register without slowing the counter" },
      { p: "A handwritten register falls behind on busy days, which is exactly when inspectors find gaps. The more reliable approach is to capture the details at billing:" },
      { ul: [
        "Mark H1, X and NDPS medicines in your medicine master once.",
        "Make the bill ask for the prescriber whenever one of them is added, and keep a doctor list so it is a two-key entry.",
        "Generate the register from bills for any date range when you need it, instead of writing it twice.",
      ] },
      { p: "This is how [Medoro's Schedule H1 register](/features/schedule-h1-compliance) works: the prescriber is required before an H1 bill can close, and the register is a report over bills that can't be edited afterwards." },
    ],
    faq: [
      ["Is a separate register compulsory for Schedule H1 drugs?", "Yes. The rule requires the supply of Schedule H1 drugs to be recorded in a separate register with the prescriber's name and address, the patient's name, the drug and the quantity."],
      ["Can the Schedule H1 register be kept on a computer?", "Many pharmacies keep it in software and print it when needed. Check with your State Drugs Control office whether they expect a printed, signed register as well."],
      ["How long should I keep the H1 register?", "Three years, available for inspection."],
      ["Is cefixime a Schedule H1 drug?", "Cefixime is on the original Schedule H1 list, along with several other cephalosporins. Check the current list, as it can be amended."],
    ],
    tools: ["free-pharmacy-invoice-generator"],
    features: ["schedule-h1-compliance", "gst-billing"],
  },
  {
    slug: "reduce-medicine-expiry-loss-in-pharmacy",
    title: "How to Reduce Medicine Expiry Loss in Your Pharmacy",
    description: "Practical ways for chemists to cut expiry loss: FEFO billing, a 90-day expiry review, distributor return windows, smarter buying with schemes and branch transfers.",
    keywords: ["reduce expiry loss pharmacy", "near expiry medicines", "fefo vs fifo pharmacy", "expiry management medical store", "expired medicine return to distributor"],
    category: "Stock & expiry",
    published: "2026-11-15",
    h1: "How to reduce medicine expiry loss in your pharmacy",
    lede: "Expired stock is money you already paid for and can't get back. Most of it is lost not because medicines expire, but because nobody noticed in time to return, move or sell them. These are the habits that make the difference.",
    body: [
      { h2: "1. Sell the earliest expiry first (FEFO, not FIFO)" },
      { p: "**FIFO** (first in, first out) sells the oldest delivery first. **FEFO** (first expiry, first out) sells the batch that expires first, whenever it arrived. In a pharmacy they aren't the same: a later delivery can carry an earlier expiry date. FEFO is the rule that actually prevents expiry." },
      { p: "On the shelf, keep the earliest expiry at the front. At the counter, the billing system should pick the earliest-expiring batch for you, so staff don't have to check dates on every strip." },
      { h2: "2. Review expiry every month, 90 days ahead" },
      { p: "A yearly clean-out finds stock that is already expired, when it is usually too late to return. A monthly look at what expires in the next 90 days gives you time to act. Sort that list by money at risk, not by date: one box of an expensive injectable matters more than ten strips of an antacid." },
      { h2: "3. Know each distributor's return window" },
      { p: "Return and expiry-claim terms differ by company and distributor. Many accept near-expiry or expired returns only within a fixed window and with conditions. Note each distributor's terms against the supplier, and act on near-expiry stock while it is still inside that window." },
      { h2: "4. Track claims until the credit note arrives" },
      { p: "Sending stock back is only half the job. Credit notes often arrive weeks later, and sometimes for less than claimed. Keep a list of open claims by distributor and follow up on old ones; an untracked claim is the same as a write-off." },
      { h2: "5. Buy to sales, not to schemes" },
      { p: "A \"10+2\" scheme looks like a 17% discount, but if the extra stock expires before it sells, the scheme loses money. Before taking a scheme on a slow mover, check how many units you actually sold in the last month and how long the expiry date gives you to sell them." },
      { table: { caption: "When a scheme pays off: 12 strips received for the price of 10", head: ["Monthly sales", "Months to sell 12", "Expiry in 4 months", "Result"], rows: [
        ["6 strips", "2", "Sells in time", "Saves about 17%"],
        ["2 strips", "6", "4 strips expire", "Loses money"],
      ] } },
      { p: "Use the [PTR, PTS and margin calculator](/tools/pharma-margin-calculator) to see your real margin before and after a scheme." },
      { h2: "6. Move slow stock to where it sells" },
      { p: "If you have more than one branch, a medicine that sits in one store often sells in another. Transfer near-expiry batches early, while there is time to sell them." },
      { h2: "7. Offer it to regular customers who use it" },
      { p: "For chronic medicines, a regular customer on that medicine will use it well before expiry. Recommend it to them first; it moves stock and keeps their refill on time." },
      { h2: "8. Block expired stock at the counter" },
      { p: "Last line of defence: an expired or recalled batch must never be billed. Good billing software refuses it outright, even if someone selects it by hand." },
      { note: "[Medoro's expiry management](/features/expiry-management) lists batches expiring in 30 to 180 days with the projected loss at cost, suggests returning, transferring or offering each one, tracks claims to distributors and blocks expired stock at billing." },
    ],
    faq: [
      ["What is the difference between FIFO and FEFO in a pharmacy?", "FIFO sells the oldest delivery first; FEFO sells the batch with the earliest expiry date first. Pharmacies should use FEFO because a newer delivery can expire earlier."],
      ["How early should I check for near-expiry medicines?", "Review what expires in the next 90 days every month. That usually leaves time to return, transfer or sell the stock."],
      ["Can I return expired medicines to the distributor?", "Often yes, but terms vary by company and distributor, including the time window and conditions. Agree them in advance and record them for each supplier."],
      ["Is it legal to sell medicines close to expiry?", "Medicines can be sold up to their expiry date, but never after it. Many pharmacies avoid selling stock that will expire before the patient finishes the course."],
    ],
    tools: ["pharma-margin-calculator"],
    features: ["expiry-management", "inventory-management"],
  },
  {
    slug: "gst-on-medicines-2025-changes",
    title: "GST on Medicines After September 2025: Guide for Chemists",
    description: "What the 22 September 2025 GST changes mean for pharmacies: 12% to 5% on most medicines, exempt life-saving drugs, old MRP stock, input credit and your billing.",
    keywords: ["gst on medicines 2025", "gst rate on medicines", "medicine gst 5 percent", "gst on ayurvedic medicine", "gst rate change pharmacy"],
    category: "GST",
    published: "2026-11-15",
    h1: "GST on medicines after September 2025: a guide for chemists",
    lede: "From 22 September 2025 the GST rates on most medicines, medical devices and many everyday pharmacy products came down. Here is what changed and what it means for your billing, your stock and your returns.",
    body: [
      { note: "This is a general summary, not tax advice. A product's rate depends on its exact entry in the GST rate notification; confirm specific products and your own position with your CA." },
      { h2: "What changed" },
      { table: { caption: "Common pharmacy items: GST before and after 22 September 2025", head: ["Item", "HSN", "Before", "From 22 Sep 2025"], rows: [
        ["Most medicines (allopathic)", "3003, 3004", "12%", "5%"],
        ["Ayurvedic, Unani, Siddha, homoeopathic medicines", "3004", "12%", "5%"],
        ["Notified life-saving drugs", "3004", "12% (some 5%)", "Nil"],
        ["Bandages, gauze, cotton", "3005", "12%", "5%"],
        ["Diagnostic kits and test strips", "3822", "12%", "5%"],
        ["Syringes, needles, catheters", "9018", "12%", "5%"],
        ["Glucometers", "9027", "12%", "5%"],
        ["Thermometers", "9025", "18%", "5%"],
        ["Toothpaste, soap, hair oil", "3306, 3401, 3305", "18%", "5%"],
      ] } },
      { p: "Look up any other item in the free [medicine HSN code and GST finder](/tools/medicine-hsn-code-finder)." },
      { h2: "Update your medicine master first" },
      { p: "Your billing software works out tax from the GST rate stored on each medicine. If those rates are still 12%, every bill is wrong. Update the rate item by item or by category, then check a few bills before the counter gets busy." },
      { h2: "Stock with the old MRP" },
      { p: "MRP includes GST, so a lower rate should mean a lower price for the patient. Manufacturers were asked to pass the reduction on through revised price lists, and stock printed with the old MRP still on the shelf should be sold at the revised price. Check your distributors' revised price lists and update the selling price on old batches." },
      { h2: "Input tax credit on old purchases" },
      { p: "Stock bought before the change carries 12% input tax, but you now collect only 5% when you sell it. The extra credit doesn't disappear: it stays in your electronic credit ledger to use against future GST. If it keeps building up, ask your CA about your options under the rules for an inverted tax structure." },
      { h2: "How GST is worked out on an MRP bill" },
      { p: "Because MRP includes GST, the tax is back-calculated on each line: **taxable value = amount × 100 ÷ (100 + GST rate)**. For a ₹105 sale at 5%, the taxable value is ₹100 and the GST ₹5, split into ₹2.50 CGST and ₹2.50 SGST inside your state, or ₹5 IGST for an out-of-state buyer." },
      { p: "You can try this with the free [GST chemist bill generator](/tools/free-pharmacy-invoice-generator)." },
      { h2: "Returns and HSN summary" },
      { p: "Your GSTR-1 HSN summary should now show most medicines under the 5% rate from the changeover date. Bills before 22 September 2025 keep the old rate; credit notes for returns of those sales follow the original bill." },
      { note: "[Medoro's GST billing](/features/gst-billing) works out tax per line from MRP at each item's rate and HSN, and builds the GSTR-1 and GSTR-3B summaries from your bills." },
    ],
    faq: [
      ["What is the GST rate on medicines now?", "Most medicines under HSN 3003 and 3004 are taxed at 5% from 22 September 2025, down from 12%. Notified life-saving drugs are exempt."],
      ["Is GST on Ayurvedic medicine 5%?", "Yes. Ayurvedic, Unani, Siddha and homoeopathic medicines moved from 12% to 5%."],
      ["Do I have to reduce the price of old stock?", "MRP includes GST, so the reduction is meant to reach the patient. Follow your distributors' and manufacturers' revised price lists for stock printed with the old MRP."],
      ["What happens to my extra input tax credit from 12% purchases?", "It stays in your credit ledger to set off against future GST. If it keeps accumulating, ask your CA about the rules for an inverted duty structure."],
    ],
    tools: ["medicine-hsn-code-finder", "free-pharmacy-invoice-generator"],
    features: ["gst-billing"],
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
        "Set up a Schedule H1 register (see our [Schedule H1 register guide](/blog/schedule-h1-register-guide))",
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
  {
    slug: "how-to-choose-pharmacy-billing-software",
    title: "How to Choose Pharmacy Billing Software: 12-Point Checklist",
    description: "A buyer's checklist for pharmacy billing software in India: billing speed, batch and expiry, GST, Schedule H1, distributor bill import, backups and cost.",
    keywords: ["best pharmacy billing software", "how to choose pharmacy software", "medical store software checklist", "pharmacy software features", "chemist software india"],
    category: "Software",
    published: "2026-11-15",
    h1: "How to choose pharmacy billing software: a 12-point checklist",
    lede: "Pharmacy software runs your counter all day, every day, so switching later is expensive. Use these twelve questions in every demo, whichever product you are looking at.",
    body: [
      { h2: "At the counter" },
      { ol: [
        "**How many keys does a bill take?** Time a three-item bill during the demo. Search by brand, salt and barcode should all work, and typos shouldn't stop it.",
        "**Does it pick the batch for you?** The earliest-expiring batch should be selected automatically, and expired stock should be impossible to bill.",
        "**Can you sell loose tablets?** Selling 4 tablets from a strip of 15 should reduce stock correctly and price the tablets without going over MRP.",
        "**Does it ask for the prescriber on Schedule H and H1 items?** And can it print the H1 register for any date range? (See our [Schedule H1 guide](/blog/schedule-h1-register-guide).)",
      ] },
      { h2: "Stock and purchases" },
      { ol: [
        "**Can it import your distributors' e-bills?** Ask to import a real CSV or Excel bill from one of your distributors during the demo, including free quantity and schemes.",
        "**Does it warn you about expiry in time?** Look for a 90-day list that shows the money at risk, not just dates. (See [how to reduce expiry loss](/blog/reduce-medicine-expiry-loss-in-pharmacy).)",
        "**Does it suggest what to reorder?** A reorder list based on recent sales saves both stock-outs and overstock.",
      ] },
      { h2: "GST and accounts" },
      { ol: [
        "**Is GST worked out per line from MRP?** Check that CGST/SGST and IGST are handled, and that GSTR-1 and GSTR-3B summaries come out of the bills. (See [GST on medicines after September 2025](/blog/gst-on-medicines-2025-changes).)",
        "**Can your CA use the data?** Tally export and Excel reports save your CA from retyping.",
      ] },
      { h2: "Running the business" },
      { ol: [
        "**What happens if the PC fails or the internet goes down?** Ask where data is stored, how backups are taken, how a restore works, and whether billing continues offline.",
        "**Can you see the shop from your phone?** Today's sales, cash, dues and expiring stock, without calling the shop.",
        "**What does it cost over three years?** Add licence or subscription, renewals, support, extra counters and branches, and any migration fees.",
      ] },
      { h2: "Red flags in a demo" },
      { ul: [
        "**Only sample data.** If the vendor won't let you try your own stock and a real distributor bill, ask why.",
        "**No clear export.** You should be able to export all your data (items, stock, customers, bills) in a standard format whenever you want. Data you can't take out locks you in.",
        "**Backups are \"your responsibility\" with no tool to help.** A pen drive copy taken when someone remembers is not a backup plan.",
        "**Prices only on a call.** If the total cost can't be written down, it will be hard to compare and easy to grow.",
        "**Support only through a dealer you haven't met.** Ask who answers when billing stops at 8 pm on a Saturday, and how.",
      ] },
      { h2: "Before you decide" },
      { p: "Ask for a free trial with your own stock, not just a demo with sample data. Import your item master, bill for a day alongside your current system, and check the expiry list and GST summary against what you expect." },
      { p: "If you are comparing specific products, our comparisons cover [Marg ERP](/compare/marg-erp-alternative), [Vyapar](/compare/vyapar-alternative-for-pharmacy) and [Logic ERP](/compare/logic-erp-alternative), with honest pros and cons for both sides." },
      { note: "Medoro answers all twelve: try it free for 7 days with your own stock. Start at [the free trial](/trial) or see [all features](/features)." },
    ],
    faq: [
      ["What is the best pharmacy billing software in India?", "The best one is the one that fits your store: fast billing, automatic batch and expiry picking, GST from MRP, a Schedule H1 register, distributor bill import, reliable backups and a clear total cost. Trial two or three with your own data."],
      ["Should pharmacy software be cloud or desktop?", "Cloud software lets you bill from several devices and see the shop from your phone without maintaining a server. Desktop software keeps working without internet. Some products, including Medoro, offer both: browser access plus offline billing on the shop network."],
      ["How long does it take to switch pharmacy software?", "If your current software can export items, batch-wise stock, suppliers and customers to Excel, most stores can switch in a day."],
    ],
    tools: ["pharma-margin-calculator", "medicine-hsn-code-finder"],
    features: ["gst-billing", "expiry-management", "ai-invoice-scanner"],
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
