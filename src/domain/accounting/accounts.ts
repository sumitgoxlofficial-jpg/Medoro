// Chart of accounts used by postings. Party balances live on the control accounts with partyId.
export const ACC = {
  cash: "Cash in hand",
  bank: "Bank account",
  sales: "Sales",
  cgst: "Output CGST",
  sgst: "Output SGST",
  inCgst: "Input CGST",
  inSgst: "Input SGST",
  igst: "Output IGST",
  inIgst: "Input IGST",
  roundOff: "Round off",
  debtors: "Sundry debtors",
  creditors: "Sundry creditors",
  purchases: "Purchases",
  inventory: "Inventory",
  salesReturns: "Sales returns",
  stockLoss: "Stock loss",
  cashDiff: "Cash short/excess",
  loyalty: "Loyalty points redeemed",
  opening: "Opening balance equity",
} as const;

export const EXPENSE_ACCOUNTS = [
  "Rent", "Electricity", "Salaries", "Staff welfare", "Delivery expense", "Repairs & maintenance",
  "Telephone & internet", "Bank charges", "Printing & stationery", "Miscellaneous expense",
] as const;
