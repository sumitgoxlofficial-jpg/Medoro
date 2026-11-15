/**
 * Free tools (/tools/<slug>): the page text, FAQ and structured data for each one. The tools themselves are client
 * components in src/components/tools. Adding a tool: add it here, to TOOL_LINKS in src/data/site-links.ts and a folder
 * src/app/tools/<slug>/page.tsx.
 */
export type ToolSlug = "pharma-margin-calculator" | "medicine-hsn-code-finder" | "free-pharmacy-invoice-generator";

export type ToolPage = {
  slug: ToolSlug;
  name: string;
  title: string;
  description: string;
  keywords: string[];
  h1: string;
  intro: string;
  featureList: string[];
  /** Explainer below the tool: plain-language how-to and the maths behind it. */
  guide: { h: string; p: string }[];
  faq: [q: string, a: string][];
  /** Feature pages this tool leads into. */
  features: string[];
};

export const TOOLS: ToolPage[] = [
  {
    slug: "pharma-margin-calculator",
    name: "PTR, PTS & margin calculator",
    title: "Medicine PTR, PTS & Retail Margin Calculator (Free)",
    description: "Free PTR and PTS calculator for medicines: enter MRP, GST slab and retailer and stockist margins to get PTR, PTS, profit per strip and the GST breakdown.",
    keywords: ["ptr calculator", "pts calculator", "ptr pts calculation from mrp", "pharma margin calculator", "medicine retailer margin calculator"],
    h1: "Medicine PTR, PTS & retail margin calculator",
    intro: "Work out the Price to Retailer (PTR) and Price to Stockist (PTS) from a medicine's MRP, the GST slab and the trade margins, and see your profit per strip and the GST you collect, pay and owe.",
    featureList: ["PTR and PTS from MRP", "GST slabs 0%, 5%, 12% and 18%", "Margin on selling price or markup on cost", "Profit per strip and per order", "Output, input and net GST"],
    guide: [
      { h: "How PTR and PTS are calculated", p: "MRP includes GST, so the first step is the price without tax: MRP ÷ (1 + GST rate). With the common margin-on-selling-price method, PTR = MRP without GST × (1 − retailer margin), and PTS = PTR × (1 − stockist margin). With the markup method, PTR = MRP without GST ÷ (1 + retailer margin) and PTS = PTR ÷ (1 + stockist margin). Distributors in India mostly quote margins on the selling price; check how your distributor defines it." },
      { h: "Why profit is worked out without GST", p: "A GST-registered pharmacy pays GST on the PTR when it buys and collects GST on the MRP when it sells. The GST paid is input tax credit, so only the difference goes to the government. Your real profit per strip is the selling price without GST minus the PTR without GST." },
      { h: "Typical trade margins", p: "For branded generics and ethical medicines, retailer margins of 20% to 30% and stockist margins of around 10% are common, while trade generics often carry much higher margins. Price-controlled (scheduled) formulations under the DPCO have their ceiling prices notified by the NPPA, which limits the margin. Use the figures on your own distributor's bill." },
    ],
    faq: [
      ["What is PTR in pharma?", "PTR (Price to Retailer) is the price at which a stockist or distributor sells a medicine to a retail pharmacy, before GST. It is printed on the distributor's bill next to the MRP."],
      ["What is PTS in pharma?", "PTS (Price to Stockist) is the price at which the manufacturer or its carrying-and-forwarding agent sells to the stockist, before GST. The gap between PTS and PTR is the stockist's margin."],
      ["How do I calculate PTR from MRP?", "Remove GST from the MRP first: MRP ÷ 1.05 for a 5% medicine. Then take off the retailer margin: for a 20% margin on the selling price, PTR = MRP without GST × 0.80. For an MRP of ₹105 at 5% GST that is ₹100 × 0.80 = ₹80."],
      ["Which GST rate applies to medicines?", "Since 22 September 2025 most medicines (HSN 3003 and 3004), including Ayurvedic and homoeopathic medicines, are taxed at 5%, and a list of life-saving drugs is exempt. Older stock and bills may still show 12%. Use the medicine HSN code finder or ask your CA for a specific product."],
    ],
    features: ["ai-invoice-scanner", "inventory-management"],
  },
  {
    slug: "medicine-hsn-code-finder",
    name: "Medicine HSN code & GST finder",
    title: "Medicine & Surgical HSN Code and GST Rate Finder",
    description: "Search HSN codes and GST rates for medicines, Ayurvedic products, surgical items, diagnostics and medical devices sold in Indian pharmacies. Free and instant.",
    keywords: ["hsn code for medicine", "medicine hsn code gst rate", "surgical items hsn code", "ayurvedic medicine hsn code", "hsn code 3004 gst rate"],
    h1: "Medicine & surgical HSN code and GST finder",
    intro: "Find the HSN code and GST rate for the medicines, surgical items, Ayurvedic products, diagnostic kits and medical devices a chemist shop sells. Search by product, salt or code, or filter by category and GST rate.",
    featureList: ["Searchable HSN dataset", "4-digit and 8-digit codes", "Current GST rate and the rate before 22 September 2025", "Filters by category and rate", "Copy the code in one click"],
    guide: [
      { h: "How many HSN digits do you need?", p: "On tax invoices, businesses with an annual turnover up to ₹5 crore must show at least a 4-digit HSN for B2B supplies, and businesses above ₹5 crore at least 6 digits on all invoices. The full 8-digit code is used for customs and is helpful for exact matching." },
      { h: "Medicines after the September 2025 GST changes", p: "From 22 September 2025 the 12% slab was removed for most goods. Most medicines, Ayurvedic and homoeopathic medicines, bandages, diagnostic kits and medical devices moved to 5%, and a list of life-saving drugs became exempt. Personal care items such as toothpaste, soap and hair oil moved from 18% to 5%." },
      { h: "Check before you file", p: "A product's rate depends on its exact description in the GST rate notification, not only its HSN heading. This list covers the common items in a pharmacy; confirm unusual products with your CA or the CBIC GST rate finder." },
    ],
    faq: [
      ["What is the HSN code for allopathic medicines?", "Medicines put up in measured doses or packed for retail sale fall under HSN 3004. The commonly used 8-digit code for other allopathic medicines is 3004 90 99. Medicines not in measured doses fall under 3003."],
      ["What is the GST rate on medicines in 2026?", "Most medicines under HSN 3003 and 3004 are taxed at 5% since 22 September 2025, down from 12%. Notified life-saving drugs are exempt (0%). Check the rate for your exact product before billing."],
      ["What is the HSN code for Ayurvedic medicines?", "Ayurvedic medicaments fall under 3004 90 11 (Unani 3004 90 12, Siddha 3004 90 13, homoeopathic 3004 90 14). They are taxed at 5%."],
      ["Where do surgical items like gloves and syringes fall?", "Surgical rubber gloves are under 4015, syringes under 9018 31, needles under 9018 32, and bandages and gauze under 3005. These are taxed at 5% since September 2025."],
    ],
    features: ["gst-billing", "ai-invoice-scanner"],
  },
  {
    slug: "free-pharmacy-invoice-generator",
    name: "Free chemist bill generator",
    title: "Free GST Chemist Bill & Pharmacy Invoice Generator",
    description: "Make a GST chemist bill online for free: pharmacy name, drug licence, GSTIN, patient and doctor, medicines with batch, expiry, MRP and GST. Print or save as PDF.",
    keywords: ["pharmacy invoice generator", "chemist bill format", "medical bill generator", "gst bill format for medical store", "free pharmacy bill maker"],
    h1: "Free GST chemist bill generator",
    intro: "Fill in your pharmacy's details, the patient and doctor, and the medicines with batch, expiry, quantity, MRP and GST. Totals, discount and the CGST/SGST split are worked out as you type; print the bill or save it as a PDF from the print window.",
    featureList: ["Pharmacy name, address, drug licence no. and GSTIN", "Patient and prescribing doctor", "Batch, expiry, quantity, MRP and GST per line", "Taxable value and CGST/SGST from MRP", "Print or save as PDF"],
    guide: [
      { h: "What a chemist's GST bill should show", p: "A tax invoice from a registered pharmacy shows the pharmacy's name, address and GSTIN, an invoice number and date, and for each item the description, HSN, quantity, value, taxable value and tax rate and amount, with CGST and SGST (or IGST) shown separately. Chemist bills usually add the drug licence numbers, batch number, expiry date and the prescribing doctor." },
      { h: "How the totals are worked out", p: "Medicines are sold at MRP, which includes GST. For each line the taxable value is the amount ÷ (1 + GST rate), and the difference is the GST, split equally between CGST and SGST for a sale inside your state. The grand total is rounded to the nearest rupee with a separate round-off line." },
      { h: "Nothing leaves your browser", p: "This tool runs entirely in your browser. The details you type are not sent to Medoro or stored anywhere, so close the tab and they are gone." },
    ],
    faq: [
      ["Is this invoice valid as a GST tax invoice?", "It contains the fields a GST tax invoice needs when you fill them in correctly, but you are responsible for the details, the invoice numbering and your GST registration. For day-to-day billing with numbered invoices, stock and GST returns, use pharmacy billing software."],
      ["How do I save the bill as a PDF?", "Click Print bill and choose Save as PDF (or Microsoft Print to PDF) as the printer in the print window."],
      ["Should a chemist bill show batch number and expiry date?", "Yes. Pharmacies in India commonly print the batch number and expiry date of each medicine on the bill so the patient and the pharmacist can trace the batch if there is a recall or complaint."],
      ["Is my data saved?", "No. Everything stays in your browser and is cleared when you close or reload the page."],
    ],
    features: ["gst-billing", "schedule-h1-compliance"],
  },
];

export const toolBySlug = (slug: string) => TOOLS.find((t) => t.slug === slug);
