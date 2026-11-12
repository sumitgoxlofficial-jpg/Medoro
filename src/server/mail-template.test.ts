import { describe, expect, it } from "vitest";
import { compose, fromText } from "./mail-template";
import { lettersMail, otpMail, welcomeMail, offerMail } from "@/staff/hrms/mails";

describe("professional email layout", () => {
  it("builds a plain-text and an HTML version with greeting, details and sign-off", () => {
    const m = welcomeMail({ name: "Asha Kulkarni", empNo: "EMP-0007", email: "asha@medoro.in", temp: "Ab12-xyz", org: "Medoro" });
    expect(m.subject).toBe("Welcome to Medoro: your employee account is ready");
    expect(m.text).toMatch(/^Dear Asha,\n\nWelcome to Medoro\./);
    expect(m.text).toContain("Employee ID: EMP-0007");
    expect(m.text).toContain("Temporary password: Ab12-xyz");
    expect(m.text).toMatch(/Warm regards,\nHuman Resources\nMedoro$/);
    expect(m.html).toContain("<!doctype html>");
    expect(m.html).toContain("Temporary password");
    expect(m.html).toContain("do not share your password");
  });
  it("shows the one-time code prominently and keeps it out of the subject", () => {
    const m = otpMail({ name: "Ravi Kumar", code: "482913", org: "Medoro" });
    expect(m.subject).not.toContain("482913");
    expect(m.text).toContain("482913\nValid for 10 minutes");
    expect(m.html).toContain(">482913<");
  });
  it("words single and multiple letters, and offers, politely", () => {
    expect(lettersMail({ name: "Ravi Kumar", labels: ["offer letter"], org: "Medoro" }).subject).toBe("Offer letter · Medoro");
    const many = lettersMail({ name: "Ravi Kumar", labels: ["nda", "experience letter"], org: "Medoro" });
    expect(many.subject).toBe("Your letters from Medoro");
    expect(many.text).toContain("• Nda");
    expect(offerMail({ name: "Meera Shah", org: "Medoro", title: "Offer letter", validDays: 7 }).text).toContain("within 7 days");
  });
  it("escapes anything a person typed, and links web addresses", () => {
    const html = compose({ greeting: "Dear <b>X</b>,", blocks: [{ p: "See https://medoro.in/x. <script>alert(1)</script>" }] }, "S").html;
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<b>X</b>");
    expect(html).toContain('<a href="https://medoro.in/x"');
  });
  it("wraps any plain message in the same layout without adding a sign-off", () => {
    const html = fromText("Dear Owner,\n\nYour report is ready.\nLine two.", "Report");
    expect(html).toContain("Dear Owner,");
    expect(html).toContain("Line two.");
    expect(html).not.toContain("Warm regards");
    expect(html).not.toContain("do not share your password");
  });
});
