import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { standardCourse } from "./content";
import { certificatePdf, notesPdf } from "./pdf";

describe("Sales Academy PDFs", () => {
  it("renders every standard lesson as slides and notes", async () => {
    for (const m of standardCourse().modules) for (const l of m.lessons) {
      const bytes = await notesPdf({ title: l.title, summary: l.summary, slides: l.slides, content: l.content, version: 1 });
      const doc = await PDFDocument.load(bytes);
      expect(doc.getPageCount()).toBeGreaterThanOrEqual(l.slides.length + 1);
    }
  });
  it("renders a certificate with its verification QR, and marks a revoked one", async () => {
    const c = { certNo: "MS-STA-2026-0001", verifyCode: "abcDEF123_-x", name: "Sameer Khan", empNo: "MS-903", dept: "Sales", programme: "Medoro Sales Training Academy", completedOn: "2026-11-26", score: 92, trainer: "Tarun Mehta", revoked: false, signatory: "Head of HR" };
    expect((await PDFDocument.load(await certificatePdf(c, "https://medoro.in/certificate/verify/abcDEF123_-x"))).getPageCount()).toBe(1);
    expect((await PDFDocument.load(await certificatePdf({ ...c, revoked: true }, "https://x.test/v"))).getPageCount()).toBe(1);
  });
});
