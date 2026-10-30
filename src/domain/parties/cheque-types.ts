export const CHEQUE_STATUS = { pending: "Pending", deposited: "Deposited", cleared: "Cleared", bounced: "Bounced" } as const;
export type ChequeStatus = keyof typeof CHEQUE_STATUS;
