/**
 * HSN codes and GST rates for what an Indian pharmacy sells, for the free finder at /tools/medicine-hsn-code-finder.
 *
 * Rates are those in force after the GST rate changes of 22 September 2025 (Notification 9/2025-Central Tax (Rate)
 * and the related exemption notification); `was` is the rate before that date where it changed. A product's rate
 * depends on its exact entry in the notification, so the tool tells users to confirm unusual items with their CA.
 * `hsn8` is filled only where the 8-digit tariff item is unambiguous for the description.
 */

export const HSN_CATEGORIES = ["Allopathic medicines", "Ayurvedic & AYUSH", "Surgical & dressings", "Diagnostics", "Medical devices", "Personal & baby care", "Nutrition & supplements"] as const;
export type HsnCategory = (typeof HSN_CATEGORIES)[number];

export type HsnEntry = {
  /** Unique id for React keys. */
  id: string;
  item: string;
  /** Common examples shown under the item and matched by search. */
  examples: string;
  category: HsnCategory;
  /** 4-digit heading (or 6-digit subheading) as printed on invoices, with spaces between pairs. */
  hsn: string;
  hsn8?: string;
  gst: number;
  /** GST rate before 22 September 2025, when it was different. */
  was?: number;
  note?: string;
};

export const HSN_CODES: HsnEntry[] = [
  // Allopathic medicines
  { id: "med-other", item: "Medicines in measured doses (tablets, capsules, syrups)", examples: "Paracetamol, pantoprazole, cetirizine, metformin, cough syrups", category: "Allopathic medicines", hsn: "3004", hsn8: "3004 90 99", gst: 5, was: 12, note: "The usual code for branded and generic allopathic medicines not covered by a more specific line" },
  { id: "med-penicillin", item: "Penicillin-group antibiotics", examples: "Amoxicillin, amoxicillin + clavulanic acid, ampicillin", category: "Allopathic medicines", hsn: "3004 10", gst: 5, was: 12 },
  { id: "med-antibiotic", item: "Other antibiotics", examples: "Azithromycin, cefixime, ofloxacin, doxycycline", category: "Allopathic medicines", hsn: "3004 20", gst: 5, was: 12 },
  { id: "med-insulin", item: "Insulin", examples: "Human insulin, insulin glargine, insulin pens and cartridges", category: "Allopathic medicines", hsn: "3004 31", hsn8: "3004 31 10", gst: 5 },
  { id: "med-steroid", item: "Corticosteroid hormone medicines", examples: "Prednisolone, dexamethasone, methylprednisolone", category: "Allopathic medicines", hsn: "3004 32", gst: 5, was: 12 },
  { id: "med-vitamin", item: "Vitamin and mineral medicines", examples: "Vitamin B-complex, vitamin D3, calcium + vitamin D3 tablets", category: "Allopathic medicines", hsn: "3004 50", gst: 5, was: 12, note: "Food supplements sold as nutraceuticals (not medicines) fall under 2106 instead" },
  { id: "med-antimalarial", item: "Antimalarial medicines", examples: "Artemether + lumefantrine, chloroquine, hydroxychloroquine", category: "Allopathic medicines", hsn: "3004 60", gst: 5, was: 12 },
  { id: "med-bulk", item: "Medicines not in measured doses", examples: "Bulk medicaments for further processing", category: "Allopathic medicines", hsn: "3003", gst: 5, was: 12 },
  { id: "med-vaccine", item: "Vaccines for human use", examples: "Rabies, tetanus toxoid, hepatitis B, influenza vaccines", category: "Allopathic medicines", hsn: "3002 41", hsn8: "3002 41 00", gst: 5 },
  { id: "med-lifesaving", item: "Notified life-saving drugs", examples: "Specified drugs for cancer, rare and chronic diseases listed in the exemption notification", category: "Allopathic medicines", hsn: "3004", gst: 0, was: 12, note: "Exempt only if the drug is named in the notification; check the list" },
  { id: "med-contrast", item: "X-ray contrast and diagnostic agents for patients", examples: "Barium sulphate contrast, iodinated contrast media", category: "Allopathic medicines", hsn: "3006 30", gst: 5, was: 12 },
  // Ayurvedic & AYUSH
  { id: "ayur", item: "Ayurvedic medicines", examples: "Chyawanprash (as medicine), arishtas, asavas, churnas, Ayurvedic tablets", category: "Ayurvedic & AYUSH", hsn: "3004", hsn8: "3004 90 11", gst: 5, was: 12 },
  { id: "unani", item: "Unani medicines", examples: "Unani formulations sold as medicines", category: "Ayurvedic & AYUSH", hsn: "3004", hsn8: "3004 90 12", gst: 5, was: 12 },
  { id: "siddha", item: "Siddha medicines", examples: "Siddha formulations sold as medicines", category: "Ayurvedic & AYUSH", hsn: "3004", hsn8: "3004 90 13", gst: 5, was: 12 },
  { id: "homeo", item: "Homoeopathic medicines", examples: "Mother tinctures, dilutions, homoeopathic tablets", category: "Ayurvedic & AYUSH", hsn: "3004", hsn8: "3004 90 14", gst: 5, was: 12 },
  { id: "biochemic", item: "Bio-chemic medicines", examples: "Bio-chemic (tissue salt) tablets", category: "Ayurvedic & AYUSH", hsn: "3004", hsn8: "3004 90 15", gst: 5, was: 12 },
  // Surgical & dressings
  { id: "cotton", item: "Absorbent cotton wool", examples: "Surgical cotton rolls and pads", category: "Surgical & dressings", hsn: "3005 90", hsn8: "3005 90 10", gst: 5, was: 12 },
  { id: "bandage", item: "Bandages, gauze and dressings", examples: "Crepe bandages, gauze swabs, roller bandages, wound dressings", category: "Surgical & dressings", hsn: "3005 90", gst: 5, was: 12 },
  { id: "adhesive", item: "Adhesive dressings and plasters", examples: "Band-aid style strips, adhesive tape for dressings", category: "Surgical & dressings", hsn: "3005 10", gst: 5, was: 12 },
  { id: "suture", item: "Sterile sutures and surgical catgut", examples: "Absorbable and non-absorbable sutures", category: "Surgical & dressings", hsn: "3006 10", gst: 5, was: 12 },
  { id: "firstaid", item: "First-aid boxes and kits", examples: "Pre-packed first-aid kits", category: "Surgical & dressings", hsn: "3006 50", hsn8: "3006 50 00", gst: 5, was: 12 },
  { id: "gloves", item: "Surgical rubber gloves", examples: "Sterile surgical gloves, examination gloves", category: "Surgical & dressings", hsn: "4015 11", hsn8: "4015 11 00", gst: 5, was: 12 },
  { id: "syringe", item: "Syringes", examples: "Disposable syringes, insulin syringes", category: "Surgical & dressings", hsn: "9018 31", hsn8: "9018 31 00", gst: 5, was: 12 },
  { id: "needle", item: "Hypodermic needles and suture needles", examples: "Disposable needles, pen needles", category: "Surgical & dressings", hsn: "9018 32", gst: 5, was: 12 },
  { id: "catheter", item: "Catheters, cannulae and similar", examples: "IV cannula, Foley catheter, urine bags with catheter", category: "Surgical & dressings", hsn: "9018 39", gst: 5, was: 12 },
  // Diagnostics
  { id: "testkit", item: "Diagnostic kits and reagents", examples: "Pregnancy test kits, rapid test kits, glucose test strips", category: "Diagnostics", hsn: "3822", gst: 5, was: 12 },
  { id: "glucometer", item: "Glucometers", examples: "Blood glucose monitoring meters", category: "Diagnostics", hsn: "9027", gst: 5, was: 12 },
  { id: "thermometer", item: "Clinical thermometers", examples: "Digital and mercury-free clinical thermometers", category: "Diagnostics", hsn: "9025", gst: 5, was: 18 },
  { id: "bpmonitor", item: "Blood pressure monitors and other medical instruments", examples: "Digital BP monitors, sphygmomanometers, stethoscopes", category: "Diagnostics", hsn: "9018", gst: 5, was: 12 },
  // Medical devices
  { id: "nebulizer", item: "Nebulisers and oxygen therapy apparatus", examples: "Compressor nebulisers, oxygen concentrators", category: "Medical devices", hsn: "9019 20", gst: 5, was: 12 },
  { id: "oxygen", item: "Medical-grade oxygen", examples: "Oxygen cylinders refilled for medical use", category: "Medical devices", hsn: "2804 40", gst: 5, was: 12 },
  { id: "ortho", item: "Orthopaedic appliances and supports", examples: "Knee caps, lumbar belts, cervical collars, splints, crutches", category: "Medical devices", hsn: "9021 10", gst: 5, was: 12 },
  { id: "hearing", item: "Hearing aids", examples: "Behind-the-ear and in-ear hearing aids", category: "Medical devices", hsn: "9021 40", gst: 0 },
  { id: "wheelchair", item: "Wheelchairs and carriages for the disabled", examples: "Manual and motorised wheelchairs", category: "Medical devices", hsn: "8713", gst: 5 },
  { id: "spectacles", item: "Corrective spectacles and lenses", examples: "Prescription glasses, spectacle lenses", category: "Medical devices", hsn: "9004 90", gst: 5, was: 12 },
  { id: "contacts", item: "Contact lenses", examples: "Daily, monthly and toric contact lenses", category: "Medical devices", hsn: "9001 30", gst: 5, was: 12 },
  // Personal & baby care
  { id: "condom", item: "Condoms and rubber contraceptives", examples: "Male condoms", category: "Personal & baby care", hsn: "4014 10", gst: 0 },
  { id: "sanitary", item: "Sanitary napkins", examples: "Sanitary pads", category: "Personal & baby care", hsn: "9619", gst: 0 },
  { id: "diaper", item: "Baby diapers and clinical (adult) diapers", examples: "Baby diapers, adult diapers, underpads", category: "Personal & baby care", hsn: "9619", gst: 5, was: 12 },
  { id: "toothpaste", item: "Toothpaste and tooth powder", examples: "Medicated and regular toothpaste", category: "Personal & baby care", hsn: "3306 10", gst: 5, was: 18 },
  { id: "soap", item: "Toilet soap", examples: "Bathing soap bars, medicated soaps", category: "Personal & baby care", hsn: "3401", gst: 5, was: 18 },
  { id: "hairoil", item: "Hair oil and shampoo", examples: "Hair oils, anti-dandruff shampoos", category: "Personal & baby care", hsn: "3305", gst: 5, was: 18 },
  { id: "sanitizer", item: "Hand sanitiser", examples: "Alcohol-based hand rubs", category: "Personal & baby care", hsn: "3808 94", gst: 18 },
  { id: "cosmetic", item: "Skin creams and cosmetics", examples: "Moisturisers, sunscreens and beauty creams (not medicated)", category: "Personal & baby care", hsn: "3304", gst: 18, note: "Medicated creams and ointments sold as medicines fall under 3004 at 5%" },
  // Nutrition & supplements
  { id: "infant", item: "Infant food and malted milk foods", examples: "Infant milk formula, cereal-based baby food, malt drinks", category: "Nutrition & supplements", hsn: "1901", gst: 5, was: 18 },
  { id: "protein", item: "Protein powders and nutraceuticals", examples: "Protein supplements, health drinks sold as food supplements", category: "Nutrition & supplements", hsn: "2106", gst: 18, note: "Check the exact entry: some 2106 food preparations moved to 5%" },
];
