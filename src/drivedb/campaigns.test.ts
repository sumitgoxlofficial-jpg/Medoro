import { describe, expect, it } from "vitest";
import { memoryDb } from "./node";
import { addCustomer } from "./trade";
import { campaignAudience, campaignPending, createCampaign, listCampaigns, offersConsent, recordCampaignResults, setOffersConsent } from "./campaigns";

const U = "owner-1";

describe("store updates from the counter", () => {
  it("only customers whose latest choice is yes, with a valid mobile, are in the audience", async () => {
    const db = await memoryDb("C1");
    const a = addCustomer(db, { name: "Asha Rao", phone: "9822041736" }).id;
    const b = addCustomer(db, { name: "Babu", phone: "9822041737" }).id;
    const noPhone = addCustomer(db, { name: "No Phone", phone: null }).id;
    expect(() => createCampaign(db, { name: "Diwali", message: "Open till 11 pm", userId: U })).toThrow(/No customer has agreed/);
    expect(() => setOffersConsent(db, { customerId: noPhone, granted: true, userId: U, method: "Asked at the counter" })).toThrow(/mobile/);
    setOffersConsent(db, { customerId: a, granted: true, userId: U, method: "Asked at the counter" });
    setOffersConsent(db, { customerId: b, granted: true, userId: U, method: "Asked at the counter" });
    setOffersConsent(db, { customerId: b, granted: false, userId: U, method: "Asked to stop at the counter" });
    expect(offersConsent(db, b)).toMatchObject({ granted: false, method: "Asked to stop at the counter" });
    expect(campaignAudience(db)).toEqual([{ id: a, name: "Asha Rao", phone: "9822041736", consentAt: expect.any(String) }]);
    // No change, no new row.
    setOffersConsent(db, { customerId: a, granted: true, userId: U, method: "Asked at the counter" });
    expect(db.from("customerConsent").count()).toBe(3);
  });

  it("resumes with the people not yet reached; an opt-out withdraws consent and is final", async () => {
    const db = await memoryDb("C1");
    const ids = ["Asha", "Babu", "Chitra"].map((n, i) => addCustomer(db, { name: n, phone: `982204173${i}` }).id);
    for (const id of ids) setOffersConsent(db, { customerId: id, granted: true, userId: U, method: "Asked at the counter" });
    const camp = createCampaign(db, { name: "Diwali", message: "  Open   till\n11 pm ", userId: U });
    expect(db.from<{ message: string }>("campaign").eq("id", camp).all()[0].message).toBe("Open till 11 pm");
    expect(campaignPending(db, camp, 2).map((p) => p.id)).toEqual([...ids].sort().slice(0, 2));
    const [x, y, z] = [...ids].sort();
    recordCampaignResults(db, camp, [{ id: x, status: "sent" }, { id: y, status: "failed", error: "Try again" }], U);
    expect(campaignPending(db, camp).map((p) => p.id)).toEqual([y, z]);
    expect(campaignPending(db, camp, 25, [y]).map((p) => p.id)).toEqual([z]); // tried in this run: not again until resumed
    recordCampaignResults(db, camp, [{ id: y, status: "sent" }, { id: z, status: "opted_out" }], U);
    expect(campaignPending(db, camp)).toEqual([]);
    expect(offersConsent(db, z)).toMatchObject({ granted: false, method: "Replied STOP on WhatsApp" });
    expect(listCampaigns(db)[0]).toMatchObject({ name: "Diwali", audience: 3, sent: 2, failed: 0, optedOut: 1, pending: 0 });
  });
});
