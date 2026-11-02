import { describe, expect, it } from "vitest";
import { memoryDb } from "./node";
import { billMessages, campaignDelivery, logMessage, openMessageIds, recordStatuses } from "./messages";

describe("WhatsApp delivery status on the counter", () => {
  it("moves forward only, keeps a failure with its reason, and stops asking about read or failed messages", async () => {
    const db = await memoryDb("C1");
    logMessage(db, { kind: "bill", refId: "sale-1", messageId: "m1" });
    logMessage(db, { kind: "campaign", refId: "camp-1", customerId: null, messageId: "m2" });
    logMessage(db, { kind: "campaign", refId: "camp-1", customerId: null, messageId: "m3" });
    expect(openMessageIds(db).sort()).toEqual(["m1", "m2", "m3"]);
    expect(recordStatuses(db, { m1: { status: "delivered", error: null }, m2: { status: "read", error: null }, m3: { status: "failed", error: "Not on WhatsApp" }, other: { status: "read", error: null } })).toBe(3);
    expect(recordStatuses(db, { m1: { status: "sent", error: null }, m3: { status: "read", error: null } })).toBe(0); // never backwards; failed is final
    expect(billMessages(db, "sale-1")[0]).toMatchObject({ status: "delivered" });
    expect(campaignDelivery(db, "camp-1")).toEqual({ delivered: 1, read: 1, failedAfter: 1 });
    expect(openMessageIds(db)).toEqual(["m1"]); // delivered can still become read
    expect(openMessageIds(db, Date.now() + 4 * 86400_000)).toEqual([]); // older than 3 days: no longer asked
  });
});
