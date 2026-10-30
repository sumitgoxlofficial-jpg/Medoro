export type Lang = "en" | "hi";

const en = {
  dash: "Dashboard", pos: "Billing (POS)", ret: "Returns & shift", inv: "Inventory", count: "Stock count", recall: "Recalls & alerts",
  exp: "Expiry prevention", intel: "Stock intelligence", pur: "Purchases", parties: "Suppliers & customers", acc: "Accounting & reports",
  wa: "WhatsApp", crm: "Customer messaging", bak: "Backup & restore", sync: "Sync & offline", users: "Users & branches",
  plan: "Subscription", privacy: "Privacy & data", help: "Help & support", admin: "Medoro admin",
  ask: "Ask AI", search: "Search medicine, generic or barcode", complete: "Complete sale", hold: "Hold", total: "Grand total",
  aiPh: "Ask about sales, stock, expiry…", sales: "Sales today", coll: "Collections", purch: "Purchases", expn: "Expenses",
  margin: "Gross margin", cdue: "Receivables", sdue: "Payables", low: "Low stock", expiring: "Expiring within 90 days",
  insights: "Insights", branchPerf: "Branch performance", activity: "Recent activity", cart: "Cart", customer: "Customer", payment: "Payment",
  Operations: "Operations", Intelligence: "Intelligence", Business: "Business", Engagement: "Engagement", System: "System",
};
const hi: typeof en = {
  dash: "डैशबोर्ड", pos: "बिलिंग (POS)", ret: "रिटर्न और शिफ्ट", inv: "इन्वेंटरी", count: "स्टॉक गिनती", recall: "रिकॉल और अलर्ट",
  exp: "एक्सपायरी रोकथाम", intel: "स्टॉक इंटेलिजेंस", pur: "खरीद", parties: "सप्लायर और ग्राहक", acc: "हिसाब और रिपोर्ट",
  wa: "व्हाट्सऐप", crm: "ग्राहक संदेश", bak: "बैकअप और रीस्टोर", sync: "सिंक और ऑफ़लाइन", users: "यूज़र और ब्रांच",
  plan: "सब्सक्रिप्शन", privacy: "प्राइवेसी और डेटा", help: "सहायता", admin: "Medoro एडमिन",
  ask: "AI से पूछें", search: "दवा, जेनेरिक नाम या बारकोड खोजें", complete: "बिक्री पूरी करें", hold: "होल्ड", total: "कुल राशि",
  aiPh: "बिक्री, स्टॉक, एक्सपायरी के बारे में पूछें…", sales: "आज की बिक्री", coll: "कलेक्शन", purch: "खरीद", expn: "खर्च",
  margin: "सकल मार्जिन", cdue: "प्राप्य", sdue: "देय", low: "कम स्टॉक", expiring: "90 दिन में एक्सपायर",
  insights: "सुझाव", branchPerf: "ब्रांच प्रदर्शन", activity: "हाल की गतिविधि", cart: "कार्ट", customer: "ग्राहक", payment: "भुगतान",
  Operations: "संचालन", Intelligence: "इंटेलिजेंस", Business: "व्यापार", Engagement: "जुड़ाव", System: "सिस्टम",
};
export const DICT = { en, hi };
export type Dict = typeof en;
export const t = (lang: Lang) => DICT[lang];
