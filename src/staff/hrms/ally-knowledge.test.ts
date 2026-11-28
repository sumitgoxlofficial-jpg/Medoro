import { describe, expect, it } from "vitest";
import { passages, policyAnswer, search, terms } from "./ally-knowledge";

const policies = [
  { title: "Work from home", category: "Attendance", body: "Employees may work from home two days a week with their manager's approval.\n\nWork from home days must be requested a day before in Leave & Approvals." },
  { title: "Travel reimbursement", category: "Money", body: "Local travel for client visits is reimbursed at actual cost with a bill.\n\n- Flights need prior approval from the super admin." },
].flatMap(passages);

describe("Ally policy search", () => {
  it("normalises words", () => expect(terms("How many WFH days were reimbursed?")).toEqual(["wfh", "day", "reimburs"]));
  it("finds the passage that answers a question and cites its policy", () => {
    const hits = search("How many days can I work from home in a week?", policies);
    expect(hits[0]).toMatchObject({ policy: "Work from home" });
    expect(hits[0].text).toContain("two days a week");
    const a = policyAnswer("Is a flight reimbursed?", policies)!;
    expect(a).toContain("Flights need prior approval");
    expect(a).toContain("— Travel reimbursement (Money)");
  });
  it("says nothing rather than guess when the policies don't cover it", () => {
    expect(policyAnswer("What is the dress code for Fridays?", policies)).toBeNull();
    expect(policyAnswer("hi", policies)).toBeNull();
  });
});
