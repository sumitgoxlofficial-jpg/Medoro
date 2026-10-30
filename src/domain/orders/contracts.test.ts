import { describe, expect, it } from "vitest";
import { canMove, deliverSchema, isOpen, mapsLink, orderSchema, saleModeFor } from "./contracts";

describe("order flow", () => {
  it("only allows the documented status moves", () => {
    expect(canMove("new", "confirmed")).toBe(true);
    expect(canMove("new", "packed")).toBe(false);
    expect(canMove("packed", "cancelled")).toBe(true);
    expect(canMove("out_for_delivery", "cancelled")).toBe(false);
    expect(canMove("out_for_delivery", "returned")).toBe(true);
    expect(["delivered", "cancelled", "returned"].every((s) => !isOpen(s as "delivered"))).toBe(true);
  });

  it("bills cash on delivery as cod, prepaid as UPI and credit as credit", () => {
    expect([saleModeFor("cod"), saleModeFor("prepaid"), saleModeFor("credit")]).toEqual(["cod", "upi", "credit"]);
  });

  it("normalises the mobile number and reads collected rupees as paise", () => {
    const o = orderSchema.parse({ source: "phone", name: "Asha", phone: "+91 98220 11122", address: "12 MG Road, Pune", payMode: "cod", items: [{ medicineId: "8b0b7c62-6a63-4f7d-9d2f-6f6ad2a3b8b1", qty: 2 }] });
    expect(o.phone).toBe("9822011122");
    expect(() => orderSchema.parse({ ...o, phone: "12345" })).toThrow(/10-digit/);
    expect(() => orderSchema.parse({ ...o, items: [] })).toThrow(/at least one item/);
    expect(deliverSchema.parse({ collected: "123.45" }).collected).toBe(12345);
    expect(mapsLink("12 MG Road, Pune")).toBe("https://www.google.com/maps/search/?api=1&query=12%20MG%20Road%2C%20Pune");
  });
});
