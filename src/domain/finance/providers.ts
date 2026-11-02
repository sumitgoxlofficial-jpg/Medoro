/**
 * Where transactions can come from, and how far each source is from working. Shown on the UPI & Bank screens
 * exactly as written here: a source is "available" only when it really works today. Reviewed 2026-11-01; see
 * docs/UPI_BANK_CONNECT_PLAN.md (section 3) for the research behind each line.
 */
export type SourceLabel = "available" | "sandbox" | "partner_required" | "unsupported";

export const LABEL_TEXT: Record<SourceLabel, string> = {
  available: "Available",
  sandbox: "Sandbox only",
  partner_required: "Partner onboarding required",
  unsupported: "Not yet supported",
};

export type Source = {
  id: string;
  kind: "bank" | "provider";
  name: string;
  label: SourceLabel;
  /** How fresh the data is, said plainly. */
  delay: string;
  /** What the pharmacy can do today. */
  today: string;
  docs?: string;
};

export const SOURCES: readonly Source[] = [
  {
    id: "statement", kind: "bank", name: "Bank statement upload (any bank)", label: "available",
    delay: "As of the statement you upload. Not real-time.",
    today: "Download your statement as CSV or Excel from net banking and upload it here. Works with every bank.",
  },
  {
    id: "aa", kind: "bank", name: "Account Aggregator (consent-based bank data)", label: "partner_required",
    delay: "Periodic, within the limits of your consent.",
    today: "Only RBI/SEBI/IRDAI/PFRDA-regulated institutions can receive Account Aggregator data. Medoro is arranging a regulated partner; until then, upload statements.",
    docs: "https://sahamati.org.in/financial-information-user-fiu",
  },
  {
    id: "bank-api", kind: "bank", name: "Direct bank connection (ICICI, Axis, HDFC and others)", label: "partner_required",
    delay: "Depends on the bank.",
    today: "Banks offer these to business current accounts after an agreement with Medoro and approval for your account. Not connected yet; upload statements.",
  },
  {
    id: "phonepe", kind: "provider", name: "PhonePe Business", label: "partner_required",
    delay: "Seconds after payment, once connected.",
    today: "PhonePe’s store QR APIs need onboarding with PhonePe. Payments to your PhonePe QR already reach your bank, so they show up in your statement.",
    docs: "https://developer.phonepe.com/offline-integration/integrated-static-qr/introduction",
  },
  {
    id: "paytm", kind: "provider", name: "Paytm for Business", label: "partner_required",
    delay: "Next day (settlement data).",
    today: "Paytm’s settlement APIs need API keys from Paytm. Use your bank statement meanwhile; Paytm settlements are recognised there.",
    docs: "https://paytmpayments.com/docs/api/settlement-api",
  },
  {
    id: "bharatpe", kind: "provider", name: "BharatPe", label: "unsupported",
    delay: "—",
    today: "BharatPe publishes no merchant transaction API. Payments reach your bank and show up in your statement.",
  },
  {
    id: "gpay", kind: "provider", name: "Google Pay for Business", label: "unsupported",
    delay: "—",
    today: "Google Pay has no list of payments received on a shop QR. Payments reach your bank and show up in your statement.",
  },
];

/**
 * Never asked for by any Medoro screen, for any source. Connection forms are checked against this list in tests.
 */
export const FORBIDDEN_FIELDS = /pin|password|passcode|otp|cvv|mpin|netbanking/i;
