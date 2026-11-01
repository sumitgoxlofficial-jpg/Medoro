import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { bankAmount, bankAutoMapping, bankRows, readStatementTable, rowFingerprint, statementDate, withOccurrence } from "./statement";
import { channelOf, parseNarration } from "./narration";
import { classify, type DedupeHave } from "./dedupe";
import { medoroRef, propose, upiIntent, type MatchData } from "./match";
import { FORBIDDEN_FIELDS, SOURCES } from "./providers";

const fx = (f: string) => new Uint8Array(readFileSync(path.join(__dirname, "../../../tests/fixtures/bank", f)));
const parse = (f: string) => { const t = readStatementTable(f, fx(f)); const m = bankAutoMapping(t)!; return { t, m, ...bankRows(t, m) }; };

describe("statement files", () => {
  it("reads an HDFC CSV: header under the account lines, totals skipped, signed amounts", () => {
    const { m, rows, problems } = parse("hdfc.csv");
    expect(m.headerRow).toBe(2);
    expect(problems).toEqual([]);
    expect(rows.map((r) => [r.date, r.amount])).toEqual([["2026-11-01", 85000], ["2026-11-01", -120000], ["2026-11-02", 2500000], ["2026-11-02", 432050]]);
  });

  it("reads an SBI .xls that is really an HTML table, and reports the bad row instead of guessing", () => {
    const { rows, problems } = parse("sbi.xls");
    expect(rows.map((r) => [r.date, r.amount, r.balance])).toEqual([["2026-11-03", 150000, 5150000], ["2026-11-03", 9900, 5159900], ["2026-11-04", 200000, 5359900]]);
    expect(rows[1].description).toContain("RAVI & CO");
    expect(problems).toEqual([{ row: 6, reason: "Date “bad date” isn’t a date." }]);
  });

  it("reads Excel 2003 XML (.xls) with times and ss:Index gaps", () => {
    const { rows } = parse("icici.xml.xls");
    expect(rows.map((r) => [r.date, r.time, r.amount])).toEqual([["2026-11-05", "10:42:10", 64000], ["2026-11-05", "18:05:00", 300000]]);
  });

  it("refuses binary .xls and PDF with a way forward", () => {
    expect(() => readStatementTable("old-binary.xls", fx("old-binary.xls"))).toThrow(/Save As/);
    expect(() => readStatementTable("s.pdf", new Uint8Array([37, 80, 68, 70]))).toThrow(/Excel or CSV/);
  });

  it("parses dates and amounts the ways banks print them", () => {
    expect(statementDate("02-Nov-2026 10:15")).toEqual({ date: "2026-11-02", time: "10:15:00" });
    expect(statementDate("02/11/26 01:05:09 PM")).toEqual({ date: "2026-11-02", time: "13:05:09" });
    expect(statementDate("2026-11-02T10:15:00")).toEqual({ date: "2026-11-02", time: "10:15:00" });
    expect(statementDate("Opening Balance")).toBeNull();
    expect(bankAmount("₹ 1,234.50 Cr")).toBe(123450);
    expect(bankAmount("-500")).toBe(-50000);
    expect(bankAmount("-")).toBeNull();
  });

  it("gives the same fingerprint to the same row and different ones to repeated identical rows", () => {
    const r = { date: "2026-11-01", amount: 10000, description: "UPI x", ref: "", balance: null };
    const [a, b] = withOccurrence([r, r]);
    expect(rowFingerprint("HDFC-4321", a, a.n)).toBe(rowFingerprint("HDFC-4321", { ...r, description: " upi  X " }, 1));
    expect(rowFingerprint("HDFC-4321", a, a.n)).not.toBe(rowFingerprint("HDFC-4321", b, b.n));
    expect(rowFingerprint("HDFC-4321", a, 1)).not.toBe(rowFingerprint("SBI-4321", a, 1));
  });
});

describe("narrations", () => {
  it("finds the channel, RRN, UPI ID and payer name in each bank's UPI format", () => {
    expect(parseNarration("BY TRANSFER-UPI/CR/430611112222/PRIYA SHAH/SBIN/priya@oksbi/Payment")).toEqual({ channel: "upi", utr: "430611112222", vpa: "priya@oksbi", name: "PRIYA SHAH" });
    expect(parseNarration("UPI-RAHUL KUMAR-rahul.k@okhdfcbank-HDFC0001234-430512345678-MDS12526000042", "0000430512345678")).toEqual({ channel: "upi", utr: "430512345678", vpa: "rahul.k@okhdfcbank", name: "RAHUL KUMAR" });
    expect(parseNarration("UPI/430755556666/Payment/meena@okicici/ICICI Bank/ICIabc")).toEqual({ channel: "upi", utr: "430755556666", vpa: "meena@okicici", name: null });
    expect(parseNarration("UPI/P2A/430711112222/ANIL JOSHI/Payment/Axis Bank").name).toBe("ANIL JOSHI");
    expect(parseNarration("UPI/MEENA RAO/430712345678/Payment").name).toBe("MEENA RAO");
    expect(parseNarration("IMPS/P2A/430799990000/SUNIL VERMA/HDFC")).toMatchObject({ channel: "imps", utr: "430799990000", name: "SUNIL VERMA" });
  });

  it("recognises NEFT UTRs, settlements, cash, cheques and charges, and leaves unclear fields empty", () => {
    expect(parseNarration("NEFT CR-SBIN0001234-CITY HOSPITAL-SBIN426306123456")).toMatchObject({ channel: "neft", utr: "SBIN426306123456", vpa: null, name: null });
    expect(channelOf("PAYTM SETTLEMENT PAYOUT 02NOV")).toBe("settlement");
    expect(channelOf("UPI SETTLEMENT PHONEPE PVT LTD")).toBe("settlement");
    expect(channelOf("CASH DEPOSIT SELF")).toBe("cash");
    expect(channelOf("CLG CHQ DEP 123456")).toBe("cheque");
    expect(channelOf("SMS CHGS QTR")).toBe("charges");
    // Two different 12-digit numbers: which one is the RRN isn't knowable.
    expect(parseNarration("UPI/123456789012/999999999999/x").utr).toBeNull();
    // An e-mail address is not a UPI ID.
    expect(parseNarration("UPI/430711112222/help@shop.com").vpa).toBeNull();
  });
});

describe("duplicates", () => {
  const have: DedupeHave[] = [
    { id: "a", account: "HDFC-1", direction: "credit", amountPaise: 85000, date: "2026-11-01", utr: "430512345678", description: "UPI-RAHUL", importId: "i1" },
    { id: "b", account: "HDFC-1", direction: "credit", amountPaise: 50000, date: "2026-11-02", utr: null, description: "CASH DEP BRANCH", importId: "i1" },
    { id: "c", account: "HDFC-1", direction: "credit", amountPaise: 70000, date: "2026-11-02", utr: null, description: "BY CLG", importId: "i1" },
  ];
  const cov = new Map([["i1", { from: "2026-11-01", to: "2026-11-02" }]]);
  const t = (x: Partial<DedupeHave>) => ({ account: "HDFC-1", direction: "credit" as const, amountPaise: 85000, date: "2026-11-01", utr: null, description: "", ...x });

  it("same UTR and amount is the same payment, from any source", () => {
    expect(classify(t({ utr: "430512345678", account: "PHONEPE", description: "anything" }), have, new Set(), cov, "i2")).toEqual({ kind: "same", id: "a", rule: 2 });
  });
  it("same day, amount and narration without UTR is the same row from another file", () => {
    expect(classify(t({ amountPaise: 50000, date: "2026-11-02", description: "Cash dep branch" }), have, new Set(), cov, "i2")).toEqual({ kind: "same", id: "b", rule: 5 });
    // ... but each existing row pairs only once.
    expect(classify(t({ amountPaise: 50000, date: "2026-11-02", description: "Cash dep branch" }), have, new Set(["b"]), cov, "i2")).toEqual({ kind: "new" });
  });
  it("alike but not provably the same: flagged for review, not merged or dropped", () => {
    expect(classify(t({ amountPaise: 70000, date: "2026-11-02", description: "CLEARING 2" }), have, new Set(), cov, "i2")).toEqual({ kind: "review", id: "c" });
  });
  it("different UTRs are different payments", () => {
    expect(classify(t({ utr: "430599999999" }), have, new Set(), cov, "i2")).toEqual({ kind: "new" });
  });
});

describe("matching", () => {
  const base: MatchData = {
    bills: [
      { saleId: "s1", invoiceNo: "S1/25-26/000042", customerId: "c1", customerName: "Rahul", date: "2026-10-20", balancePaise: 85000 },
      { saleId: "s2", invoiceNo: "S1/25-26/000043", customerId: "c2", customerName: "Asha", date: "2026-10-21", balancePaise: 40000 },
      { saleId: "s3", invoiceNo: "S1/25-26/000044", customerId: "c3", customerName: "Ravi", date: "2026-10-22", balancePaise: 40000 },
    ],
    counter: [{ paymentId: "p1", saleId: "s9", invoiceNo: "S1/25-26/000050", amountPaise: 64000, date: "2026-11-05", ref: "430755556666" }, { paymentId: "p2", saleId: "s10", invoiceNo: "S1/25-26/000051", amountPaise: 12000, date: "2026-11-05", ref: null }],
    receipts: [], rejected: new Set(), knownPayers: new Map(), autoKnownPayers: false,
  };
  const credit = (id: string, amt: number, description = "", utr: string | null = null, vpa: string | null = null, date = "2026-11-05") => ({ id, remainingPaise: amt, date, description, utr, vpa });

  it("rule 1: Medoro reference in the narration matches automatically", () => {
    const p = propose([credit("t1", 85000, "UPI-RAHUL-x@ok-430512345678-MDS12526000042")], base).get("t1")!;
    expect(p[0]).toMatchObject({ target: "bill", targetId: "s1", rule: 1, auto: true, amountPaise: 85000 });
    expect(medoroRef("S1/25-26/000042")).toBe("MDS12526000042");
  });
  it("rule 2: UTR typed at the counter verifies that counter payment", () => {
    expect(propose([credit("t1", 64000, "UPI/430755556666/x", "430755556666")], base).get("t1")![0]).toMatchObject({ target: "counter", targetId: "p1", rule: 2, auto: true });
  });
  it("rule 3: invoice number in the narration, partial payment allocates what was paid", () => {
    expect(propose([credit("t1", 20000, "NEFT HOSP S1/25-26/000043 PART")], base).get("t1")![0]).toMatchObject({ targetId: "s2", rule: 3, auto: true, amountPaise: 20000 });
  });
  it("rule 4: unique amount is only a suggestion; two bills of the same amount stay suggestions (rule 5)", () => {
    expect(propose([credit("t1", 85000)], base).get("t1")![0]).toMatchObject({ targetId: "s1", rule: 4, auto: false });
    const two = propose([credit("t1", 40000)], base).get("t1")!;
    expect(two.map((p) => [p.targetId, p.rule, p.auto])).toEqual([["s2", 5, false], ["s3", 5, false]]);
  });
  it("rule 4 becomes automatic only for a known payer when the owner allows it", () => {
    const known = { ...base, knownPayers: new Map([["rahul@ok", "c1"]]), autoKnownPayers: true };
    expect(propose([credit("t1", 85000, "", null, "rahul@ok")], known).get("t1")![0]).toMatchObject({ rule: 4, auto: true });
    expect(propose([credit("t1", 85000, "", null, "rahul@ok")], { ...known, autoKnownPayers: false }).get("t1")![0].auto).toBe(false);
  });
  it("two credits pointing at the same bill: neither is automatic", () => {
    const r = propose([credit("t1", 85000, "MDS12526000042"), credit("t2", 85000, "MDS12526000042")], base);
    expect([r.get("t1")![0].auto, r.get("t2")![0].auto]).toEqual([false, false]);
  });
  it("a rejected pair is never proposed again", () => {
    expect(propose([credit("t1", 85000)], { ...base, rejected: new Set(["t1|s1"]) }).get("t1")).toEqual([]);
  });
  it("UPI QR uses the pharmacy's own UPI ID", () => {
    expect(upiIntent("shop@okhdfcbank", "Shop", 85000, "MDS12526000042")).toBe("upi://pay?pa=shop%40okhdfcbank&pn=Shop&am=850.00&cu=INR&tn=MDS12526000042");
  });
});

describe("sources", () => {
  it("only the statement upload claims to work today", () => {
    expect(SOURCES.filter((s) => s.label === "available").map((s) => s.id)).toEqual(["statement"]);
  });
  it("never asks for PINs, passwords or OTPs", () => {
    expect(FORBIDDEN_FIELDS.test("upiPin")).toBe(true);
    expect(SOURCES.map((s) => s.today).join(" ")).not.toMatch(/enter your (pin|password|otp)/i);
  });
});
