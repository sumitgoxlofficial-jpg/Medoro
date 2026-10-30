export const PURPOSES = ["transactional", "marketing"] as const;
export const CHANNELS = ["whatsapp", "sms"] as const;
export const METHODS = ["counter", "form", "reply", "import"] as const;
export type Purpose = (typeof PURPOSES)[number];
export type Channel = (typeof CHANNELS)[number];
export type Method = (typeof METHODS)[number];
export const METHOD_LABEL: Record<Method, string> = { counter: "Verbal, at the counter", form: "Signed form", reply: "Reply on WhatsApp or SMS", import: "Imported from earlier records" };
export const PURPOSE_LABEL: Record<Purpose, string> = { transactional: "Invoices & reminders", marketing: "Offers & campaigns" };
