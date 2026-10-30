export const BANK_FIELDS = { date: "Date", description: "Narration", ref: "Cheque / ref no.", debit: "Withdrawal (debit)", credit: "Deposit (credit)", amount: "Amount (signed, or with Dr/Cr)", balance: "Balance" } as const;
export type BankField = keyof typeof BANK_FIELDS;
export type BankMapping = { headerRow: number; cols: Partial<Record<BankField, number>> };
