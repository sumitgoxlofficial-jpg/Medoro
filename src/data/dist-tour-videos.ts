import type { TourVideo } from "./tour-videos";

/**
 * Medoro Distribution video library (website /videos/distribution): the product tour recorded on a demo distributor
 * (Medoro Demo Pharma Distributors, Ranchi) with fictional data, Hinglish voice-over and subtitles. Each of the 26 parts
 * is one MP4 named <slug>.mp4 in the same place as the pharmacy videos (VIDEO_BASE: the Supabase Storage bucket
 * tour-videos); a guide plays its parts one after another. Thumbnails are in public/videos/thumbs.
 */
export const DIST_VIDEOS: TourVideo[] = [
  {
    "slug": "distribution-complete-product-tour",
    "kind": "guide",
    "product": "distribution",
    "title": "Medoro Distribution – Complete Product Tour",
    "subtitle": "Poora tour: sign-up se lekar orders, GST, dispatch, collection aur reports tak",
    "description": "The whole of Medoro Distribution in one video, all 26 parts.",
    "seconds": 5404,
    "sources": [
      "distribution-part-01-introduction-to-medoro-distribution",
      "distribution-part-02-account-registration-and-free-trial",
      "distribution-part-03-distributor-business-onboarding",
      "distribution-part-04-distributor-dashboard",
      "distribution-part-05-product-and-medicine-catalogue",
      "distribution-part-06-godown-and-inventory-management",
      "distribution-part-07-supplier-and-pharmaceutical-company-management",
      "distribution-part-08-purchase-orders-and-grn",
      "distribution-part-09-batch-expiry-and-stock-reservation",
      "distribution-part-10-sales-orders-and-order-management",
      "distribution-part-11-credit-control-and-chemist-outstanding",
      "distribution-part-12-schemes-discounts-and-free-goods",
      "distribution-part-13-wholesale-gst-billing-and-invoicing",
      "distribution-part-14-chemist-returns-and-expiry-claims",
      "distribution-part-15-godown-picking-and-packing",
      "distribution-part-16-dispatch-and-delivery-management",
      "distribution-part-17-collections-and-payment-management",
      "distribution-part-18-salesman-management-and-territory-operations",
      "distribution-part-19-chemist-ordering-portal",
      "distribution-part-20-accounts-ledgers-and-financial-management",
      "distribution-part-21-gst-management-and-tax-reports",
      "distribution-part-22-mis-reports-and-business-intelligence",
      "distribution-part-23-user-roles-permissions-and-audit-trail",
      "distribution-part-24-backup-security-and-data-management",
      "distribution-part-25-subscription-language-and-a-complete-business-day",
      "distribution-part-26-conclusion-and-product-overview"
    ],
    "chapters": [
      {
        "at": 0,
        "label": "Part 01 – Introduction to Medoro Distribution"
      },
      {
        "at": 198,
        "label": "Part 02 – Account Registration and Free Trial"
      },
      {
        "at": 446,
        "label": "Part 03 – Distributor Business Onboarding"
      },
      {
        "at": 715,
        "label": "Part 04 – Distributor Dashboard"
      },
      {
        "at": 889,
        "label": "Part 05 – Product and Medicine Catalogue"
      },
      {
        "at": 1099,
        "label": "Part 06 – Godown and Inventory Management"
      },
      {
        "at": 1335,
        "label": "Part 07 – Supplier and Pharmaceutical Company Management"
      },
      {
        "at": 1542,
        "label": "Part 08 – Purchase Orders and GRN"
      },
      {
        "at": 1817,
        "label": "Part 09 – Batch, Expiry and Stock Reservation"
      },
      {
        "at": 2021,
        "label": "Part 10 – Sales Orders and Order Management"
      },
      {
        "at": 2224,
        "label": "Part 11 – Credit Control and Chemist Outstanding"
      },
      {
        "at": 2449,
        "label": "Part 12 – Schemes, Discounts and Free Goods"
      },
      {
        "at": 2663,
        "label": "Part 13 – Wholesale GST Billing and Invoicing"
      },
      {
        "at": 2901,
        "label": "Part 14 – Chemist Returns and Expiry Claims"
      },
      {
        "at": 3113,
        "label": "Part 15 – Godown Picking and Packing"
      },
      {
        "at": 3272,
        "label": "Part 16 – Dispatch and Delivery Management"
      },
      {
        "at": 3453,
        "label": "Part 17 – Collections and Payment Management"
      },
      {
        "at": 3620,
        "label": "Part 18 – Salesman Management and Territory Operations"
      },
      {
        "at": 3791,
        "label": "Part 19 – Chemist Ordering Portal"
      },
      {
        "at": 4027,
        "label": "Part 20 – Accounts, Ledgers and Financial Management"
      },
      {
        "at": 4211,
        "label": "Part 21 – GST Management and Tax Reports"
      },
      {
        "at": 4357,
        "label": "Part 22 – MIS Reports and Business Intelligence"
      },
      {
        "at": 4576,
        "label": "Part 23 – User Roles, Permissions and Audit Trail"
      },
      {
        "at": 4809,
        "label": "Part 24 – Backup, Security and Data Management"
      },
      {
        "at": 4982,
        "label": "Part 25 – Subscription, Language and a Complete Business Day"
      },
      {
        "at": 5282,
        "label": "Part 26 – Conclusion and Product Overview"
      }
    ]
  },
  {
    "slug": "distribution-registration-and-distributor-onboarding",
    "kind": "guide",
    "product": "distribution",
    "title": "Registration and Distributor Onboarding – Medoro Distribution",
    "subtitle": "2 parts: Account Registration and Free Trial, Distributor Business Onboarding",
    "description": "Registration and Distributor Onboarding, in 2 parts of the Medoro Distribution product tour.",
    "seconds": 517,
    "sources": [
      "distribution-part-02-account-registration-and-free-trial",
      "distribution-part-03-distributor-business-onboarding"
    ],
    "chapters": [
      {
        "at": 0,
        "label": "Part 02 – Account Registration and Free Trial"
      },
      {
        "at": 248,
        "label": "Part 03 – Distributor Business Onboarding"
      }
    ]
  },
  {
    "slug": "distribution-dashboard-and-business-overview",
    "kind": "guide",
    "product": "distribution",
    "title": "Dashboard and Business Overview – Medoro Distribution",
    "subtitle": "2 parts: Introduction to Medoro Distribution, Distributor Dashboard",
    "description": "Dashboard and Business Overview, in 2 parts of the Medoro Distribution product tour.",
    "seconds": 372,
    "sources": [
      "distribution-part-01-introduction-to-medoro-distribution",
      "distribution-part-04-distributor-dashboard"
    ],
    "chapters": [
      {
        "at": 0,
        "label": "Part 01 – Introduction to Medoro Distribution"
      },
      {
        "at": 198,
        "label": "Part 04 – Distributor Dashboard"
      }
    ]
  },
  {
    "slug": "distribution-product-inventory-and-godown-management",
    "kind": "guide",
    "product": "distribution",
    "title": "Product, Inventory and Godown Management – Medoro Distribution",
    "subtitle": "3 parts: Product and Medicine Catalogue, Godown and Inventory Management, Batch, Expiry and Stock Reservation",
    "description": "Product, Inventory and Godown Management, in 3 parts of the Medoro Distribution product tour.",
    "seconds": 650,
    "sources": [
      "distribution-part-05-product-and-medicine-catalogue",
      "distribution-part-06-godown-and-inventory-management",
      "distribution-part-09-batch-expiry-and-stock-reservation"
    ],
    "chapters": [
      {
        "at": 0,
        "label": "Part 05 – Product and Medicine Catalogue"
      },
      {
        "at": 210,
        "label": "Part 06 – Godown and Inventory Management"
      },
      {
        "at": 446,
        "label": "Part 09 – Batch, Expiry and Stock Reservation"
      }
    ]
  },
  {
    "slug": "distribution-purchase-suppliers-and-grn",
    "kind": "guide",
    "product": "distribution",
    "title": "Purchase, Suppliers and GRN – Medoro Distribution",
    "subtitle": "2 parts: Supplier and Pharmaceutical Company Management, Purchase Orders and GRN",
    "description": "Purchase, Suppliers and GRN, in 2 parts of the Medoro Distribution product tour.",
    "seconds": 482,
    "sources": [
      "distribution-part-07-supplier-and-pharmaceutical-company-management",
      "distribution-part-08-purchase-orders-and-grn"
    ],
    "chapters": [
      {
        "at": 0,
        "label": "Part 07 – Supplier and Pharmaceutical Company Management"
      },
      {
        "at": 207,
        "label": "Part 08 – Purchase Orders and GRN"
      }
    ]
  },
  {
    "slug": "distribution-sales-orders-and-credit-control",
    "kind": "guide",
    "product": "distribution",
    "title": "Sales Orders and Credit Control – Medoro Distribution",
    "subtitle": "2 parts: Sales Orders and Order Management, Credit Control and Chemist Outstanding",
    "description": "Sales Orders and Credit Control, in 2 parts of the Medoro Distribution product tour.",
    "seconds": 428,
    "sources": [
      "distribution-part-10-sales-orders-and-order-management",
      "distribution-part-11-credit-control-and-chemist-outstanding"
    ],
    "chapters": [
      {
        "at": 0,
        "label": "Part 10 – Sales Orders and Order Management"
      },
      {
        "at": 203,
        "label": "Part 11 – Credit Control and Chemist Outstanding"
      }
    ]
  },
  {
    "slug": "distribution-schemes-discounts-and-gst-invoicing",
    "kind": "guide",
    "product": "distribution",
    "title": "Schemes, Discounts and GST Invoicing – Medoro Distribution",
    "subtitle": "2 parts: Schemes, Discounts and Free Goods, Wholesale GST Billing and Invoicing",
    "description": "Schemes, Discounts and GST Invoicing, in 2 parts of the Medoro Distribution product tour.",
    "seconds": 452,
    "sources": [
      "distribution-part-12-schemes-discounts-and-free-goods",
      "distribution-part-13-wholesale-gst-billing-and-invoicing"
    ],
    "chapters": [
      {
        "at": 0,
        "label": "Part 12 – Schemes, Discounts and Free Goods"
      },
      {
        "at": 214,
        "label": "Part 13 – Wholesale GST Billing and Invoicing"
      }
    ]
  },
  {
    "slug": "distribution-chemist-portal-and-salesman-app",
    "kind": "guide",
    "product": "distribution",
    "title": "Chemist Portal and Salesman App – Medoro Distribution",
    "subtitle": "2 parts: Salesman Management and Territory Operations, Chemist Ordering Portal",
    "description": "Chemist Portal and Salesman App, in 2 parts of the Medoro Distribution product tour.",
    "seconds": 407,
    "sources": [
      "distribution-part-18-salesman-management-and-territory-operations",
      "distribution-part-19-chemist-ordering-portal"
    ],
    "chapters": [
      {
        "at": 0,
        "label": "Part 18 – Salesman Management and Territory Operations"
      },
      {
        "at": 171,
        "label": "Part 19 – Chemist Ordering Portal"
      }
    ]
  },
  {
    "slug": "distribution-picking-packing-and-dispatch",
    "kind": "guide",
    "product": "distribution",
    "title": "Picking, Packing and Dispatch – Medoro Distribution",
    "subtitle": "2 parts: Godown Picking and Packing, Dispatch and Delivery Management",
    "description": "Picking, Packing and Dispatch, in 2 parts of the Medoro Distribution product tour.",
    "seconds": 340,
    "sources": [
      "distribution-part-15-godown-picking-and-packing",
      "distribution-part-16-dispatch-and-delivery-management"
    ],
    "chapters": [
      {
        "at": 0,
        "label": "Part 15 – Godown Picking and Packing"
      },
      {
        "at": 159,
        "label": "Part 16 – Dispatch and Delivery Management"
      }
    ]
  },
  {
    "slug": "distribution-collections-accounts-and-gst",
    "kind": "guide",
    "product": "distribution",
    "title": "Collections, Accounts and GST – Medoro Distribution",
    "subtitle": "3 parts: Collections and Payment Management, Accounts, Ledgers and Financial Management, GST Management and Tax Reports",
    "description": "Collections, Accounts and GST, in 3 parts of the Medoro Distribution product tour.",
    "seconds": 497,
    "sources": [
      "distribution-part-17-collections-and-payment-management",
      "distribution-part-20-accounts-ledgers-and-financial-management",
      "distribution-part-21-gst-management-and-tax-reports"
    ],
    "chapters": [
      {
        "at": 0,
        "label": "Part 17 – Collections and Payment Management"
      },
      {
        "at": 167,
        "label": "Part 20 – Accounts, Ledgers and Financial Management"
      },
      {
        "at": 351,
        "label": "Part 21 – GST Management and Tax Reports"
      }
    ]
  },
  {
    "slug": "distribution-expiry-claims-and-mis-analytics",
    "kind": "guide",
    "product": "distribution",
    "title": "Expiry Claims and MIS Analytics – Medoro Distribution",
    "subtitle": "2 parts: Chemist Returns and Expiry Claims, MIS Reports and Business Intelligence",
    "description": "Expiry Claims and MIS Analytics, in 2 parts of the Medoro Distribution product tour.",
    "seconds": 431,
    "sources": [
      "distribution-part-14-chemist-returns-and-expiry-claims",
      "distribution-part-22-mis-reports-and-business-intelligence"
    ],
    "chapters": [
      {
        "at": 0,
        "label": "Part 14 – Chemist Returns and Expiry Claims"
      },
      {
        "at": 212,
        "label": "Part 22 – MIS Reports and Business Intelligence"
      }
    ]
  },
  {
    "slug": "distribution-staff-security-backup-and-subscription",
    "kind": "guide",
    "product": "distribution",
    "title": "Staff, Security, Backup and Subscription – Medoro Distribution",
    "subtitle": "3 parts: User Roles, Permissions and Audit Trail, Backup, Security and Data Management, Subscription, Language and a Complete Business Day",
    "description": "Staff, Security, Backup and Subscription, in 3 parts of the Medoro Distribution product tour.",
    "seconds": 706,
    "sources": [
      "distribution-part-23-user-roles-permissions-and-audit-trail",
      "distribution-part-24-backup-security-and-data-management",
      "distribution-part-25-subscription-language-and-a-complete-business-day"
    ],
    "chapters": [
      {
        "at": 0,
        "label": "Part 23 – User Roles, Permissions and Audit Trail"
      },
      {
        "at": 233,
        "label": "Part 24 – Backup, Security and Data Management"
      },
      {
        "at": 406,
        "label": "Part 25 – Subscription, Language and a Complete Business Day"
      }
    ]
  },
  {
    "slug": "distribution-part-01-introduction-to-medoro-distribution",
    "kind": "part",
    "part": 1,
    "product": "distribution",
    "title": "Part 01 – Introduction to Medoro Distribution",
    "subtitle": "Medoro Distribution kya hai, kiske liye hai, aur dashboard ki pehli jhalak",
    "description": "Part 01 of the Medoro Distribution product tour: introduction to medoro distribution, shown on the real software with a fictional Ranchi distributor.",
    "seconds": 198,
    "sources": [
      "distribution-part-01-introduction-to-medoro-distribution"
    ],
    "chapters": []
  },
  {
    "slug": "distribution-part-02-account-registration-and-free-trial",
    "kind": "part",
    "part": 2,
    "product": "distribution",
    "title": "Part 02 – Account Registration and Free Trial",
    "subtitle": "Website se 7-day free trial, email code, login aur password recovery",
    "description": "Part 02 of the Medoro Distribution product tour: account registration and free trial, shown on the real software with a fictional Ranchi distributor.",
    "seconds": 248,
    "sources": [
      "distribution-part-02-account-registration-and-free-trial"
    ],
    "chapters": []
  },
  {
    "slug": "distribution-part-03-distributor-business-onboarding",
    "kind": "part",
    "part": 3,
    "product": "distribution",
    "title": "Part 03 – Distributor Business Onboarding",
    "subtitle": "Business, GSTIN, drug licence, godown, recovery kit aur two-step sign-in",
    "description": "Part 03 of the Medoro Distribution product tour: distributor business onboarding, shown on the real software with a fictional Ranchi distributor.",
    "seconds": 269,
    "sources": [
      "distribution-part-03-distributor-business-onboarding"
    ],
    "chapters": []
  },
  {
    "slug": "distribution-part-04-distributor-dashboard",
    "kind": "part",
    "part": 4,
    "product": "distribution",
    "title": "Part 04 – Distributor Dashboard",
    "subtitle": "Ek screen par bikri, vasooli, bakaya aur order pipeline",
    "description": "Part 04 of the Medoro Distribution product tour: distributor dashboard, shown on the real software with a fictional Ranchi distributor.",
    "seconds": 174,
    "sources": [
      "distribution-part-04-distributor-dashboard"
    ],
    "chapters": []
  },
  {
    "slug": "distribution-part-05-product-and-medicine-catalogue",
    "kind": "part",
    "part": 5,
    "product": "distribution",
    "title": "Part 05 – Product and Medicine Catalogue",
    "subtitle": "PTR, PTS, MRP, HSN, GST, schedule aur barcode ke saath products",
    "description": "Part 05 of the Medoro Distribution product tour: product and medicine catalogue, shown on the real software with a fictional Ranchi distributor.",
    "seconds": 210,
    "sources": [
      "distribution-part-05-product-and-medicine-catalogue"
    ],
    "chapters": []
  },
  {
    "slug": "distribution-part-06-godown-and-inventory-management",
    "kind": "part",
    "part": 6,
    "product": "distribution",
    "title": "Part 06 – Godown and Inventory Management",
    "subtitle": "Godowns, racks, batch-wise stock, adjustment aur godown transfer",
    "description": "Part 06 of the Medoro Distribution product tour: godown and inventory management, shown on the real software with a fictional Ranchi distributor.",
    "seconds": 236,
    "sources": [
      "distribution-part-06-godown-and-inventory-management"
    ],
    "chapters": []
  },
  {
    "slug": "distribution-part-07-supplier-and-pharmaceutical-company-management",
    "kind": "part",
    "part": 7,
    "product": "distribution",
    "title": "Part 07 – Supplier and Pharmaceutical Company Management",
    "subtitle": "Companies, principals, suppliers, supplier ledger aur payment",
    "description": "Part 07 of the Medoro Distribution product tour: supplier and pharmaceutical company management, shown on the real software with a fictional Ranchi distributor.",
    "seconds": 207,
    "sources": [
      "distribution-part-07-supplier-and-pharmaceutical-company-management"
    ],
    "chapters": []
  },
  {
    "slug": "distribution-part-08-purchase-orders-and-grn",
    "kind": "part",
    "part": 8,
    "product": "distribution",
    "title": "Part 08 – Purchase Orders and GRN",
    "subtitle": "Purchase order se GRN tak: batch, expiry, free goods aur totals check",
    "description": "Part 08 of the Medoro Distribution product tour: purchase orders and grn, shown on the real software with a fictional Ranchi distributor.",
    "seconds": 275,
    "sources": [
      "distribution-part-08-purchase-orders-and-grn"
    ],
    "chapters": []
  },
  {
    "slug": "distribution-part-09-batch-expiry-and-stock-reservation",
    "kind": "part",
    "part": 9,
    "product": "distribution",
    "title": "Part 09 – Batch, Expiry and Stock Reservation",
    "subtitle": "FEFO batch reservation, expiry bands aur stock statement",
    "description": "Part 09 of the Medoro Distribution product tour: batch, expiry and stock reservation, shown on the real software with a fictional Ranchi distributor.",
    "seconds": 204,
    "sources": [
      "distribution-part-09-batch-expiry-and-stock-reservation"
    ],
    "chapters": []
  },
  {
    "slug": "distribution-part-10-sales-orders-and-order-management",
    "kind": "part",
    "part": 10,
    "product": "distribution",
    "title": "Part 10 – Sales Orders and Order Management",
    "subtitle": "Order book karna, special rate, scheme, approve aur reject",
    "description": "Part 10 of the Medoro Distribution product tour: sales orders and order management, shown on the real software with a fictional Ranchi distributor.",
    "seconds": 203,
    "sources": [
      "distribution-part-10-sales-orders-and-order-management"
    ],
    "chapters": []
  },
  {
    "slug": "distribution-part-11-credit-control-and-chemist-outstanding",
    "kind": "part",
    "part": 11,
    "product": "distribution",
    "title": "Part 11 – Credit Control and Chemist Outstanding",
    "subtitle": "Credit limit, overdue, hold aur ₹50,000 limit wala practical example",
    "description": "Part 11 of the Medoro Distribution product tour: credit control and chemist outstanding, shown on the real software with a fictional Ranchi distributor.",
    "seconds": 225,
    "sources": [
      "distribution-part-11-credit-control-and-chemist-outstanding"
    ],
    "chapters": []
  },
  {
    "slug": "distribution-part-12-schemes-discounts-and-free-goods",
    "kind": "part",
    "part": 12,
    "product": "distribution",
    "title": "Part 12 – Schemes, Discounts and Free Goods",
    "subtitle": "10+2 jaisi schemes, discount aur free goods ka stock aur margin par asar",
    "description": "Part 12 of the Medoro Distribution product tour: schemes, discounts and free goods, shown on the real software with a fictional Ranchi distributor.",
    "seconds": 214,
    "sources": [
      "distribution-part-12-schemes-discounts-and-free-goods"
    ],
    "chapters": []
  },
  {
    "slug": "distribution-part-13-wholesale-gst-billing-and-invoicing",
    "kind": "part",
    "part": 13,
    "product": "distribution",
    "title": "Part 13 – Wholesale GST Billing and Invoicing",
    "subtitle": "CGST + SGST aur IGST ke saath wholesale GST invoice aur A4 print",
    "description": "Part 13 of the Medoro Distribution product tour: wholesale gst billing and invoicing, shown on the real software with a fictional Ranchi distributor.",
    "seconds": 238,
    "sources": [
      "distribution-part-13-wholesale-gst-billing-and-invoicing"
    ],
    "chapters": []
  },
  {
    "slug": "distribution-part-14-chemist-returns-and-expiry-claims",
    "kind": "part",
    "part": 14,
    "product": "distribution",
    "title": "Part 14 – Chemist Returns and Expiry Claims",
    "subtitle": "Credit note, quarantine, company par expiry claim aur reconciliation",
    "description": "Part 14 of the Medoro Distribution product tour: chemist returns and expiry claims, shown on the real software with a fictional Ranchi distributor.",
    "seconds": 212,
    "sources": [
      "distribution-part-14-chemist-returns-and-expiry-claims"
    ],
    "chapters": []
  },
  {
    "slug": "distribution-part-15-godown-picking-and-packing",
    "kind": "part",
    "part": 15,
    "product": "distribution",
    "title": "Part 15 – Godown Picking and Packing",
    "subtitle": "Godown phone par rack aur batch dekh kar picking, short pick aur packing",
    "description": "Part 15 of the Medoro Distribution product tour: godown picking and packing, shown on the real software with a fictional Ranchi distributor.",
    "seconds": 159,
    "sources": [
      "distribution-part-15-godown-picking-and-packing"
    ],
    "chapters": []
  },
  {
    "slug": "distribution-part-16-dispatch-and-delivery-management",
    "kind": "part",
    "part": 16,
    "product": "distribution",
    "title": "Part 16 – Dispatch and Delivery Management",
    "subtitle": "Van trip, delivery phone, receiver ka naam aur door par UPI collection",
    "description": "Part 16 of the Medoro Distribution product tour: dispatch and delivery management, shown on the real software with a fictional Ranchi distributor.",
    "seconds": 181,
    "sources": [
      "distribution-part-16-dispatch-and-delivery-management"
    ],
    "chapters": []
  },
  {
    "slug": "distribution-part-17-collections-and-payment-management",
    "kind": "part",
    "part": 17,
    "product": "distribution",
    "title": "Part 17 – Collections and Payment Management",
    "subtitle": "Cash, UPI, NEFT aur cheque collection, FIFO bill adjustment",
    "description": "Part 17 of the Medoro Distribution product tour: collections and payment management, shown on the real software with a fictional Ranchi distributor.",
    "seconds": 167,
    "sources": [
      "distribution-part-17-collections-and-payment-management"
    ],
    "chapters": []
  },
  {
    "slug": "distribution-part-18-salesman-management-and-territory-operations",
    "kind": "part",
    "part": 18,
    "product": "distribution",
    "title": "Part 18 – Salesman Management and Territory Operations",
    "subtitle": "Territories, salesmen aur salesman ka field app",
    "description": "Part 18 of the Medoro Distribution product tour: salesman management and territory operations, shown on the real software with a fictional Ranchi distributor.",
    "seconds": 171,
    "sources": [
      "distribution-part-18-salesman-management-and-territory-operations"
    ],
    "chapters": []
  },
  {
    "slug": "distribution-part-19-chemist-ordering-portal",
    "kind": "part",
    "part": 19,
    "product": "distribution",
    "title": "Part 19 – Chemist Ordering Portal",
    "subtitle": "Chemist registration, approval, catalogue aur portal se order",
    "description": "Part 19 of the Medoro Distribution product tour: chemist ordering portal, shown on the real software with a fictional Ranchi distributor.",
    "seconds": 236,
    "sources": [
      "distribution-part-19-chemist-ordering-portal"
    ],
    "chapters": []
  },
  {
    "slug": "distribution-part-20-accounts-ledgers-and-financial-management",
    "kind": "part",
    "part": 20,
    "product": "distribution",
    "title": "Part 20 – Accounts, Ledgers and Financial Management",
    "subtitle": "Trial balance, day book, chemist aur supplier ledger, bank reconciliation",
    "description": "Part 20 of the Medoro Distribution product tour: accounts, ledgers and financial management, shown on the real software with a fictional Ranchi distributor.",
    "seconds": 184,
    "sources": [
      "distribution-part-20-accounts-ledgers-and-financial-management"
    ],
    "chapters": []
  },
  {
    "slug": "distribution-part-21-gst-management-and-tax-reports",
    "kind": "part",
    "part": 21,
    "product": "distribution",
    "title": "Part 21 – GST Management and Tax Reports",
    "subtitle": "GSTR-1, GSTR-3B JSON aur HSN summary CA ke liye",
    "description": "Part 21 of the Medoro Distribution product tour: gst management and tax reports, shown on the real software with a fictional Ranchi distributor.",
    "seconds": 146,
    "sources": [
      "distribution-part-21-gst-management-and-tax-reports"
    ],
    "chapters": []
  },
  {
    "slug": "distribution-part-22-mis-reports-and-business-intelligence",
    "kind": "part",
    "part": 22,
    "product": "distribution",
    "title": "Part 22 – MIS Reports and Business Intelligence",
    "subtitle": "Chaudah MIS reports aur business intelligence",
    "description": "Part 22 of the Medoro Distribution product tour: mis reports and business intelligence, shown on the real software with a fictional Ranchi distributor.",
    "seconds": 219,
    "sources": [
      "distribution-part-22-mis-reports-and-business-intelligence"
    ],
    "chapters": []
  },
  {
    "slug": "distribution-part-23-user-roles-permissions-and-audit-trail",
    "kind": "part",
    "part": 23,
    "product": "distribution",
    "title": "Part 23 – User Roles, Permissions and Audit Trail",
    "subtitle": "Roles, permission matrix aur audit trail",
    "description": "Part 23 of the Medoro Distribution product tour: user roles, permissions and audit trail, shown on the real software with a fictional Ranchi distributor.",
    "seconds": 233,
    "sources": [
      "distribution-part-23-user-roles-permissions-and-audit-trail"
    ],
    "chapters": []
  },
  {
    "slug": "distribution-part-24-backup-security-and-data-management",
    "kind": "part",
    "part": 24,
    "product": "distribution",
    "title": "Part 24 – Backup, Security and Data Management",
    "subtitle": "Encrypted backup, restore test aur data ki suraksha",
    "description": "Part 24 of the Medoro Distribution product tour: backup, security and data management, shown on the real software with a fictional Ranchi distributor.",
    "seconds": 173,
    "sources": [
      "distribution-part-24-backup-security-and-data-management"
    ],
    "chapters": []
  },
  {
    "slug": "distribution-part-25-subscription-language-and-a-complete-business-day",
    "kind": "part",
    "part": 25,
    "product": "distribution",
    "title": "Part 25 – Subscription, Language and a Complete Business Day",
    "subtitle": "Subscription, Hindi interface aur ek poora business din",
    "description": "Part 25 of the Medoro Distribution product tour: subscription, language and a complete business day, shown on the real software with a fictional Ranchi distributor.",
    "seconds": 300,
    "sources": [
      "distribution-part-25-subscription-language-and-a-complete-business-day"
    ],
    "chapters": []
  },
  {
    "slug": "distribution-part-26-conclusion-and-product-overview",
    "kind": "part",
    "part": 26,
    "product": "distribution",
    "title": "Part 26 – Conclusion and Product Overview",
    "subtitle": "Medoro Distribution ka saar aur free trial kaise shuru karein",
    "description": "Part 26 of the Medoro Distribution product tour: conclusion and product overview, shown on the real software with a fictional Ranchi distributor.",
    "seconds": 122,
    "sources": [
      "distribution-part-26-conclusion-and-product-overview"
    ],
    "chapters": []
  }
];
