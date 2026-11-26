/**
 * Medoro Pharmacy video library (website /videos): the product tour and its guides, recorded on a demo pharmacy with
 * fictional data. Each of the 26 parts is one MP4 in public/videos/files (Hinglish subtitles burned in; on Vercel they
 * play from the Supabase Storage bucket tour-videos, see VIDEO_BASE and .vercelignore) with a thumbnail in public/videos/thumbs, and may also have a YouTube ID (tour-youtube.ts); a guide, the complete tour included, plays
 * its parts one after another.
 */
export type TourVideo = {
  slug: string; kind: "guide" | "part"; part?: number; title: string; subtitle: string; description: string;
  seconds: number;
  /** The parts this video plays, in order (slugs of part videos; a part lists itself). */
  sources: string[];
  /** Where each part starts in a guide, in seconds from its start. */
  chapters: { at: number; label: string }[];
};

export const TOUR_VIDEOS: TourVideo[] = [
  {
    "slug": "complete-product-tour",
    "kind": "guide",
    "title": "Medoro Pharmacy – Complete Product Tour",
    "subtitle": "Poora product tour: sign-up se lekar billing, GST, accounts aur AI tak",
    "description": "The whole of Medoro Pharmacy in one video, all 26 parts.",
    "seconds": 3010,
    "sources": [
      "part-01-introduction-to-medoro",
      "part-02-account-registration",
      "part-03-pharmacy-onboarding",
      "part-04-dashboard",
      "part-05-medicine-management",
      "part-06-inventory-and-stock",
      "part-07-purchase-management",
      "part-08-purchase-invoice-import",
      "part-09-billing-and-pos",
      "part-10-prescription-and-schedule-h-h1",
      "part-11-customer-management",
      "part-12-sales-returns",
      "part-13-supplier-management",
      "part-14-accounts-and-expenses",
      "part-15-gst-and-tax",
      "part-16-whatsapp-integration",
      "part-17-ai-assistant",
      "part-18-offline-billing",
      "part-19-branches-and-counters",
      "part-20-staff-and-users",
      "part-21-backup-and-data-security",
      "part-22-reports-and-analytics",
      "part-23-subscription-and-plans",
      "part-24-language-settings",
      "part-25-a-complete-pharmacy-day",
      "part-26-conclusion"
    ],
    "chapters": [
      {
        "at": 0,
        "label": "Part 01 – Introduction to Medoro"
      },
      {
        "at": 90,
        "label": "Part 02 – Account Registration"
      },
      {
        "at": 315,
        "label": "Part 03 – Pharmacy Onboarding"
      },
      {
        "at": 588,
        "label": "Part 04 – Dashboard"
      },
      {
        "at": 697,
        "label": "Part 05 – Medicine Management"
      },
      {
        "at": 829,
        "label": "Part 06 – Inventory & Stock"
      },
      {
        "at": 969,
        "label": "Part 07 – Purchase Management"
      },
      {
        "at": 1094,
        "label": "Part 08 – Purchase Invoice Import"
      },
      {
        "at": 1194,
        "label": "Part 09 – Billing & POS"
      },
      {
        "at": 1358,
        "label": "Part 10 – Prescription & Schedule H/H1"
      },
      {
        "at": 1480,
        "label": "Part 11 – Customer Management"
      },
      {
        "at": 1587,
        "label": "Part 12 – Sales Returns"
      },
      {
        "at": 1679,
        "label": "Part 13 – Supplier Management"
      },
      {
        "at": 1770,
        "label": "Part 14 – Accounts & Expenses"
      },
      {
        "at": 1893,
        "label": "Part 15 – GST & Tax"
      },
      {
        "at": 2001,
        "label": "Part 16 – WhatsApp Integration"
      },
      {
        "at": 2093,
        "label": "Part 17 – AI Assistant"
      },
      {
        "at": 2233,
        "label": "Part 18 – Offline Billing"
      },
      {
        "at": 2325,
        "label": "Part 19 – Branches & Counters"
      },
      {
        "at": 2423,
        "label": "Part 20 – Staff & Users"
      },
      {
        "at": 2530,
        "label": "Part 21 – Backup & Data Security"
      },
      {
        "at": 2634,
        "label": "Part 22 – Reports & Analytics"
      },
      {
        "at": 2725,
        "label": "Part 23 – Subscription & Plans"
      },
      {
        "at": 2797,
        "label": "Part 24 – Language Settings"
      },
      {
        "at": 2857,
        "label": "Part 25 – A Complete Pharmacy Day"
      },
      {
        "at": 2948,
        "label": "Part 26 – Conclusion"
      }
    ]
  },
  {
    "slug": "account-registration-and-onboarding",
    "kind": "guide",
    "title": "Account Registration and Onboarding",
    "subtitle": "Account banaiye aur pharmacy setup kijiye",
    "description": "Free trial sign-up, email verification, login and the full pharmacy setup.",
    "seconds": 498,
    "sources": [
      "part-02-account-registration",
      "part-03-pharmacy-onboarding"
    ],
    "chapters": [
      {
        "at": 0,
        "label": "Part 02 – Account Registration"
      },
      {
        "at": 225,
        "label": "Part 03 – Pharmacy Onboarding"
      }
    ]
  },
  {
    "slug": "dashboard-tutorial",
    "kind": "guide",
    "title": "Dashboard Tutorial",
    "subtitle": "Ek nazar mein poore business ka haal",
    "description": "Every dashboard tile explained with real demo data.",
    "seconds": 109,
    "sources": [
      "part-04-dashboard"
    ],
    "chapters": [
      {
        "at": 0,
        "label": "Part 04 – Dashboard"
      }
    ]
  },
  {
    "slug": "medicine-and-inventory-management",
    "kind": "guide",
    "title": "Medicine and Inventory Management",
    "subtitle": "Medicine master, stock, batch, expiry aur FEFO",
    "description": "Medicine master, stock import, batches, expiry and transfers.",
    "seconds": 272,
    "sources": [
      "part-05-medicine-management",
      "part-06-inventory-and-stock"
    ],
    "chapters": [
      {
        "at": 0,
        "label": "Part 05 – Medicine Management"
      },
      {
        "at": 132,
        "label": "Part 06 – Inventory & Stock"
      }
    ]
  },
  {
    "slug": "purchase-and-supplier-management",
    "kind": "guide",
    "title": "Purchase and Supplier Management",
    "subtitle": "Supplier bill, e-bill import, payments aur statements",
    "description": "Supplier bills, e-bill import, supplier payments and statements.",
    "seconds": 316,
    "sources": [
      "part-07-purchase-management",
      "part-08-purchase-invoice-import",
      "part-13-supplier-management"
    ],
    "chapters": [
      {
        "at": 0,
        "label": "Part 07 – Purchase Management"
      },
      {
        "at": 125,
        "label": "Part 08 – Purchase Invoice Import"
      },
      {
        "at": 225,
        "label": "Part 13 – Supplier Management"
      }
    ]
  },
  {
    "slug": "billing-and-pos-tutorial",
    "kind": "guide",
    "title": "Billing and POS Tutorial",
    "subtitle": "Tez billing, Schedule H aur returns",
    "description": "Counter billing, Schedule H/H1 prescriptions and returns.",
    "seconds": 378,
    "sources": [
      "part-09-billing-and-pos",
      "part-10-prescription-and-schedule-h-h1",
      "part-12-sales-returns"
    ],
    "chapters": [
      {
        "at": 0,
        "label": "Part 09 – Billing & POS"
      },
      {
        "at": 164,
        "label": "Part 10 – Prescription & Schedule H/H1"
      },
      {
        "at": 286,
        "label": "Part 12 – Sales Returns"
      }
    ]
  },
  {
    "slug": "gst-and-accounting-tutorial",
    "kind": "guide",
    "title": "GST and Accounting Tutorial",
    "subtitle": "Kharch, books, GST returns aur Tally",
    "description": "Expenses, day book, trial balance, P&L, GST returns and Tally.",
    "seconds": 231,
    "sources": [
      "part-14-accounts-and-expenses",
      "part-15-gst-and-tax"
    ],
    "chapters": [
      {
        "at": 0,
        "label": "Part 14 – Accounts & Expenses"
      },
      {
        "at": 123,
        "label": "Part 15 – GST & Tax"
      }
    ]
  },
  {
    "slug": "customer-and-whatsapp-management",
    "kind": "guide",
    "title": "Customer and WhatsApp Management",
    "subtitle": "Customers, udhaar aur WhatsApp",
    "description": "Customers, credit and statements, and WhatsApp messaging.",
    "seconds": 199,
    "sources": [
      "part-11-customer-management",
      "part-16-whatsapp-integration"
    ],
    "chapters": [
      {
        "at": 0,
        "label": "Part 11 – Customer Management"
      },
      {
        "at": 107,
        "label": "Part 16 – WhatsApp Integration"
      }
    ]
  },
  {
    "slug": "ai-assistant-tutorial",
    "kind": "guide",
    "title": "AI Assistant Tutorial",
    "subtitle": "English, Hindi aur Hinglish mein sawaal",
    "description": "Ask about sales, profit, stock and expiry in your own words.",
    "seconds": 140,
    "sources": [
      "part-17-ai-assistant"
    ],
    "chapters": [
      {
        "at": 0,
        "label": "Part 17 – AI Assistant"
      }
    ]
  },
  {
    "slug": "offline-billing-and-backup-tutorial",
    "kind": "guide",
    "title": "Offline Billing and Backup Tutorial",
    "subtitle": "Internet ke bina billing, aur data ki suraksha",
    "description": "Billing offline and keeping your data safe in your own Google Drive.",
    "seconds": 196,
    "sources": [
      "part-18-offline-billing",
      "part-21-backup-and-data-security"
    ],
    "chapters": [
      {
        "at": 0,
        "label": "Part 18 – Offline Billing"
      },
      {
        "at": 92,
        "label": "Part 21 – Backup & Data Security"
      }
    ]
  },
  {
    "slug": "reports-and-analytics-tutorial",
    "kind": "guide",
    "title": "Reports and Analytics Tutorial",
    "subtitle": "Reports, insights aur forecasts",
    "description": "Reports, insights, forecasts and the books.",
    "seconds": 91,
    "sources": [
      "part-22-reports-and-analytics"
    ],
    "chapters": [
      {
        "at": 0,
        "label": "Part 22 – Reports & Analytics"
      }
    ]
  },
  {
    "slug": "staff-and-branch-management-tutorial",
    "kind": "guide",
    "title": "Staff and Branch Management Tutorial",
    "subtitle": "Branches, counters, staff aur permissions",
    "description": "Branches, counters, staff, roles and the audit trail.",
    "seconds": 205,
    "sources": [
      "part-19-branches-and-counters",
      "part-20-staff-and-users"
    ],
    "chapters": [
      {
        "at": 0,
        "label": "Part 19 – Branches & Counters"
      },
      {
        "at": 98,
        "label": "Part 20 – Staff & Users"
      }
    ]
  },
  {
    "slug": "part-01-introduction-to-medoro",
    "kind": "part",
    "part": 1,
    "title": "Part 01 – Introduction to Medoro",
    "subtitle": "Medoro Pharmacy kya hai, kiske liye hai, aur kyon",
    "description": "What Medoro Pharmacy is, who it is for (medical stores, retail and hospital pharmacies, chains) and a first look at the dashboard.",
    "seconds": 90,
    "sources": [
      "part-01-introduction-to-medoro"
    ],
    "chapters": []
  },
  {
    "slug": "part-02-account-registration",
    "kind": "part",
    "part": 2,
    "title": "Part 02 – Account Registration",
    "subtitle": "Account kaise banayein, verify aur login karein",
    "description": "Start the 7-day free trial from medoro.in, confirm your email with a code, sign in with two-step verification and reset a forgotten password.",
    "seconds": 225,
    "sources": [
      "part-02-account-registration"
    ],
    "chapters": []
  },
  {
    "slug": "part-03-pharmacy-onboarding",
    "kind": "part",
    "part": 3,
    "title": "Part 03 – Pharmacy Onboarding",
    "subtitle": "Pharmacy setup: details, GST, licence, branches aur team",
    "description": "Set up your pharmacy: name, GSTIN, drug licence, pharmacist, address, pharmacy code, branches and counters, team invites, recovery kit and Drive storage.",
    "seconds": 273,
    "sources": [
      "part-03-pharmacy-onboarding"
    ],
    "chapters": []
  },
  {
    "slug": "part-04-dashboard",
    "kind": "part",
    "part": 4,
    "title": "Part 04 – Dashboard",
    "subtitle": "Ek nazar mein poore business ka haal",
    "description": "Every dashboard tile explained: sales, margin, purchases, expenses, receivables, payables, sales chart, collections, low stock, expiry and branch performance.",
    "seconds": 109,
    "sources": [
      "part-04-dashboard"
    ],
    "chapters": []
  },
  {
    "slug": "part-05-medicine-management",
    "kind": "part",
    "part": 5,
    "title": "Part 05 – Medicine Management",
    "subtitle": "Medicine add, edit, salt, GST, MRP aur barcode",
    "description": "Add and edit medicines with salt, MRP, GST, pack and loose units, reorder level, rack, barcode and schedule; deactivate without losing history.",
    "seconds": 132,
    "sources": [
      "part-05-medicine-management"
    ],
    "chapters": []
  },
  {
    "slug": "part-06-inventory-and-stock",
    "kind": "part",
    "part": 6,
    "title": "Part 06 – Inventory & Stock",
    "subtitle": "Stock, batch, expiry, FEFO, adjustment aur transfer",
    "description": "Stock, opening-stock import, batches and FEFO, stock corrections, stock count, quarantine and recalled batches, and branch transfers.",
    "seconds": 140,
    "sources": [
      "part-06-inventory-and-stock"
    ],
    "chapters": []
  },
  {
    "slug": "part-07-purchase-management",
    "kind": "part",
    "part": 7,
    "title": "Part 07 – Purchase Management",
    "subtitle": "Supplier bill, batch, expiry, free qty aur payment",
    "description": "Enter a supplier bill with batch, expiry, free packs and rate; stock and supplier dues update together; pay the supplier.",
    "seconds": 125,
    "sources": [
      "part-07-purchase-management"
    ],
    "chapters": []
  },
  {
    "slug": "part-08-purchase-invoice-import",
    "kind": "part",
    "part": 8,
    "title": "Part 08 – Purchase Invoice Import",
    "subtitle": "Distributor e-bill import, review aur posting",
    "description": "Import a distributor e-bill file (CSV, Excel or text), review every line and post it into stock.",
    "seconds": 100,
    "sources": [
      "part-08-purchase-invoice-import"
    ],
    "chapters": []
  },
  {
    "slug": "part-09-billing-and-pos",
    "kind": "part",
    "part": 9,
    "title": "Part 09 – Billing & POS",
    "subtitle": "Tez billing: F2, barcode, FEFO, hold, split payment, UPI aur credit",
    "description": "Fast billing: F2 search by brand, salt or barcode, FEFO batches, customer and discount, hold (F4) and resume, split payment, UPI, card and credit, GST invoice.",
    "seconds": 164,
    "sources": [
      "part-09-billing-and-pos"
    ],
    "chapters": []
  },
  {
    "slug": "part-10-prescription-and-schedule-h-h1",
    "kind": "part",
    "part": 10,
    "title": "Part 10 – Prescription & Schedule H/H1",
    "subtitle": "Prescriber details, Schedule H aur H1 register",
    "description": "Schedule H and H1 rules at the counter: prescriber, registration number and patient, sales by doctor and the Schedule H1 register.",
    "seconds": 122,
    "sources": [
      "part-10-prescription-and-schedule-h-h1"
    ],
    "chapters": []
  },
  {
    "slug": "part-11-customer-management",
    "kind": "part",
    "part": 11,
    "title": "Part 11 – Customer Management",
    "subtitle": "Customers, credit limit, udhaar aur WhatsApp consent",
    "description": "Customers, credit limits, WhatsApp consent, receiving dues and the customer statement.",
    "seconds": 107,
    "sources": [
      "part-11-customer-management"
    ],
    "chapters": []
  },
  {
    "slug": "part-12-sales-returns",
    "kind": "part",
    "part": 12,
    "title": "Part 12 – Sales Returns",
    "subtitle": "Bill dhoondhiye, return lijiye, refund aur stock update",
    "description": "Find a bill, return items, choose condition and refund mode, and issue a credit note; the day-end summary.",
    "seconds": 92,
    "sources": [
      "part-12-sales-returns"
    ],
    "chapters": []
  },
  {
    "slug": "part-13-supplier-management",
    "kind": "part",
    "part": 13,
    "title": "Part 13 – Supplier Management",
    "subtitle": "Suppliers, khareed ka itihaas, bakaaya aur pricing",
    "description": "Supplier dues and payments, supplier-wise purchase prices, claims, cheques and the supplier statement.",
    "seconds": 91,
    "sources": [
      "part-13-supplier-management"
    ],
    "chapters": []
  },
  {
    "slug": "part-14-accounts-and-expenses",
    "kind": "part",
    "part": 14,
    "title": "Part 14 – Accounts & Expenses",
    "subtitle": "Kharch, cash book, bank aur profit",
    "description": "Expenses, cash book, bank statement matching, and the books: day book, trial balance and profit & loss.",
    "seconds": 123,
    "sources": [
      "part-14-accounts-and-expenses"
    ],
    "chapters": []
  },
  {
    "slug": "part-15-gst-and-tax",
    "kind": "part",
    "part": 15,
    "title": "Part 15 – GST & Tax",
    "subtitle": "MRP-inclusive GST, CGST/SGST, HSN, GSTR-1 aur GSTR-3B",
    "description": "MRP-inclusive GST, CGST/SGST and IGST, HSN, GSTR-1 and GSTR-3B files, and Tally Prime export. Review with your CA before filing.",
    "seconds": 108,
    "sources": [
      "part-15-gst-and-tax"
    ],
    "chapters": []
  },
  {
    "slug": "part-16-whatsapp-integration",
    "kind": "part",
    "part": 16,
    "title": "Part 16 – WhatsApp Integration",
    "subtitle": "Invoice PDF, refill reminder, consent aur opt-out",
    "description": "WhatsApp invoices, delivery log, refill and payment reminders, consent and STOP opt-out (not connected in the demo).",
    "seconds": 92,
    "sources": [
      "part-16-whatsapp-integration"
    ],
    "chapters": []
  },
  {
    "slug": "part-17-ai-assistant",
    "kind": "part",
    "part": 17,
    "title": "Part 17 – AI Assistant",
    "subtitle": "English, Hindi aur Hinglish mein sawaal poochhiye",
    "description": "Ask questions in English, Hindi and Hinglish: sales, profit, low stock, expiry and reorders, answered from your own data.",
    "seconds": 140,
    "sources": [
      "part-17-ai-assistant"
    ],
    "chapters": []
  },
  {
    "slug": "part-18-offline-billing",
    "kind": "part",
    "part": 18,
    "title": "Part 18 – Offline Billing",
    "subtitle": "Internet band ho tab bhi billing, phir apne-aap sync",
    "description": "Bill with the internet off and watch the changes sync to Google Drive when it comes back.",
    "seconds": 92,
    "sources": [
      "part-18-offline-billing"
    ],
    "chapters": []
  },
  {
    "slug": "part-19-branches-and-counters",
    "kind": "part",
    "part": 19,
    "title": "Part 19 – Branches & Counters",
    "subtitle": "Branches, counters, transfer aur branch-wise report",
    "description": "Branches and counters, staff per branch, stock transfers and the owner view across branches.",
    "seconds": 98,
    "sources": [
      "part-19-branches-and-counters"
    ],
    "chapters": []
  },
  {
    "slug": "part-20-staff-and-users",
    "kind": "part",
    "part": 20,
    "title": "Part 20 – Staff & Users",
    "subtitle": "Staff account, roles, permissions, 2-step aur audit trail",
    "description": "Add staff, roles and permissions, view as a role, two-step verification and the audit trail.",
    "seconds": 107,
    "sources": [
      "part-20-staff-and-users"
    ],
    "chapters": []
  },
  {
    "slug": "part-21-backup-and-data-security",
    "kind": "part",
    "part": 21,
    "title": "Part 21 – Backup & Data Security",
    "subtitle": "Google Drive backup, encryption, recovery aur privacy",
    "description": "Your data in your own Google Drive, encrypted with your key; restore, privacy controls and integration health.",
    "seconds": 104,
    "sources": [
      "part-21-backup-and-data-security"
    ],
    "chapters": []
  },
  {
    "slug": "part-22-reports-and-analytics",
    "kind": "part",
    "part": 22,
    "title": "Part 22 – Reports & Analytics",
    "subtitle": "Sales, profit, best sellers, expiry, stock value aur forecast",
    "description": "Sales and profit, best sellers, expiry, forecasts, slow and dead stock, audit anomalies and the books.",
    "seconds": 91,
    "sources": [
      "part-22-reports-and-analytics"
    ],
    "chapters": []
  },
  {
    "slug": "part-23-subscription-and-plans",
    "kind": "part",
    "part": 23,
    "title": "Part 23 – Subscription & Plans",
    "subtitle": "Free trial, plans, upgrade aur payment",
    "description": "The 7-day free trial, plans, the subscription page and renewal (no payment made in the video).",
    "seconds": 72,
    "sources": [
      "part-23-subscription-and-plans"
    ],
    "chapters": []
  },
  {
    "slug": "part-24-language-settings",
    "kind": "part",
    "part": 24,
    "title": "Part 24 – Language Settings",
    "subtitle": "English se Hindi interface, aur Hindi mein AI",
    "description": "Switch the whole app between English and Hindi, and ask the assistant in Hindi.",
    "seconds": 60,
    "sources": [
      "part-24-language-settings"
    ],
    "chapters": []
  },
  {
    "slug": "part-25-a-complete-pharmacy-day",
    "kind": "part",
    "part": 25,
    "title": "Part 25 – A Complete Pharmacy Day",
    "subtitle": "Subah se shaam tak: purchase, billing, return aur report",
    "description": "One complete day: dashboard, stock check, supplier bill, UPI sale, return, and the owner checking profit.",
    "seconds": 91,
    "sources": [
      "part-25-a-complete-pharmacy-day"
    ],
    "chapters": []
  },
  {
    "slug": "part-26-conclusion",
    "kind": "part",
    "part": 26,
    "title": "Part 26 – Conclusion",
    "subtitle": "Medoro Pharmacy: aapki medical store ka smart saathi",
    "description": "A summary of Medoro Pharmacy and how to start your free trial or book a demo.",
    "seconds": 62,
    "sources": [
      "part-26-conclusion"
    ],
    "chapters": []
  }
];

/**
 * Where the MP4s are served from: /videos/files on this site, or NEXT_PUBLIC_VIDEO_BASE_URL (a storage bucket or CDN
 * folder holding the same files), which is then allowed in the content-security policy's media-src.
 */
export const VIDEO_BASE = (process.env.NEXT_PUBLIC_VIDEO_BASE_URL || "/videos/files").replace(/\/$/, "");
export const partUrl = (slug: string) => `${VIDEO_BASE}/${slug}.mp4`;
export const thumbUrl = (v: TourVideo) => `/videos/thumbs/${v.slug}.webp`;
export const videoBySlug = (slug: string) => TOUR_VIDEOS.find((v) => v.slug === slug);
export function clock(s: number) {
  const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, x = Math.floor(s % 60);
  return (h ? `${h}:${String(m).padStart(2, "0")}` : String(m)) + `:${String(x).padStart(2, "0")}`;
}
