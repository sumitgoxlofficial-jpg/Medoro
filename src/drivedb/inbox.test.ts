import { describe, expect, it } from "vitest";
import { memoryDb } from "./node";
import { newDeviceKeys } from "./keyring";
import { applyPayments, openForDevice, receiptIdOf, sealForDevice, type InboxPayment } from "./inbox";
import { customerBalance } from "./trade";

const pay = (o: Partial<InboxPayment> = {}): InboxPayment => ({ paymentId: "pay_ABC123456", linkId: "plink_X1", amountPaise: 15000, customerId: "c1", saleId: null, method: "upi", paidAt: "2026-11-01T10:00:00.000Z", ...o });

describe("online payments inbox (device side)", () => {
  it("only the device it was sealed for can open a payment", async () => {
    const mine = await newDeviceKeys(), other = await newDeviceKeys();
    const sealed = await sealForDevice(mine.publicJwk, pay());
    expect(await openForDevice(mine.privateKey, sealed)).toEqual(pay());
    await expect(openForDevice(other.privateKey, sealed)).rejects.toThrow();
    expect(sealed).not.toContain("pay_ABC123456");
  });

  it("records a paid link as a UPI receipt once, and waits for a customer the device doesn't have yet", async () => {
    const db = await memoryDb("D1");
    db.from("customer").insert({ id: "c1", name: "Asha", phone: "9822000001", creditLimitPaise: 100000 });
    db.from("customerReceipt").insert({ customerId: "c1", amountPaise: -40000, mode: "cash", ref: "Opening balance", userId: "u", at: "2026-01-01T00:00:00.000Z" }); // owes ₹400
    expect(customerBalance(db, "c1")).toBe(40000);
    const done = applyPayments(db, [pay(), pay({ paymentId: "pay_LATER0001", customerId: "c-not-here" })]);
    expect(done).toEqual(["pay_ABC123456"]);
    expect(customerBalance(db, "c1")).toBe(25000);
    const r = db.engine.all<{ id: string; mode: string; ref: string; userId: string }>("SELECT id, mode, ref, userId FROM customerReceipt WHERE id = ?", [receiptIdOf("pay_ABC123456")])[0];
    expect(r).toMatchObject({ mode: "upi", userId: "online", ref: expect.stringContaining("pay_ABC123456") });
    // Picked up again (another counter, or a retry): still one receipt, and Medoro may delete it.
    expect(applyPayments(db, [pay()])).toEqual(["pay_ABC123456"]);
    expect(customerBalance(db, "c1")).toBe(25000);
  });
});
