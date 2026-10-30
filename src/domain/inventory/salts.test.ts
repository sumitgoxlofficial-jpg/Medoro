import { describe, expect, it } from "vitest";
import { compositionOf, normStrength, parseComposition, saltKey, saltsFrom, searchTokens, similarity } from "./salts";

describe("salt composition", () => {
  it("normalises strengths", () => {
    expect(normStrength("650 MG")).toBe("650mg");
    expect(normStrength("0.50 mg")).toBe("0.5mg");
    expect(normStrength("1,000 mg")).toBe("1000mg");
    expect(normStrength("60000 IU")).toBe("60000iu");
    expect(normStrength("50 µg")).toBe("50mcg");
    expect(normStrength("2 gm")).toBe("2g");
    expect(normStrength("250mg/5ml")).toBe("250mg/5ml");
  });

  it("parses compositions and keys them independent of order and spacing", () => {
    expect(parseComposition("Paracetamol 500mg + Caffeine 25 mg")).toEqual([{ name: "Paracetamol", strength: "500mg" }, { name: "Caffeine", strength: "25mg" }]);
    expect(parseComposition("Vitamin D3 60000 IU")).toEqual([{ name: "Vitamin D3", strength: "60000iu" }]);
    expect(parseComposition("Amoxycillin (500 mg), Clavulanic Acid (125 mg)")).toEqual([{ name: "Amoxycillin", strength: "500mg" }, { name: "Clavulanic Acid", strength: "125mg" }]);
    const a = saltKey(parseComposition("Paracetamol 500mg + Caffeine 25mg"));
    expect(a).toBe("caffeine 25mg + paracetamol 500mg");
    expect(saltKey(parseComposition("caffeine 25 MG, PARACETAMOL  500 mg"))).toBe(a);
    expect(saltKey(parseComposition("Paracetamol 650mg"))).not.toBe(saltKey(parseComposition("Paracetamol 500mg")));
    expect(saltKey([])).toBeNull();
  });

  it("derives composition from generic + strength, zipping combinations", () => {
    expect(saltsFrom("Paracetamol + Caffeine", "500 mg + 25 mg")).toEqual([{ name: "Paracetamol", strength: "500mg" }, { name: "Caffeine", strength: "25mg" }]);
    expect(compositionOf({ composition: "", generic: "Paracetamol", strength: "650 mg" })).toEqual({ composition: "Paracetamol 650mg", saltKey: "paracetamol 650mg" });
    expect(compositionOf({ composition: "Pantoprazole 40mg + Domperidone 30mg", generic: "x", strength: "y" }).saltKey).toBe("domperidone 30mg + pantoprazole 40mg");
    // Two salts with one strength can't be split: keep the names so the key is still stable.
    expect(compositionOf({ generic: "Amoxicillin + Clavulanate", strength: "625 mg" })).toEqual({ composition: "Amoxicillin + Clavulanate", saltKey: "amoxicillin + clavulanate" });
  });

  it("matches the migration backfill for single-salt medicines", () => {
    // SQL: lower(trim(collapse(generic))) || ' ' || lower(remove spaces(strength)) for strengths like "650 mg".
    const sql = (g: string, s: string) => g.trim().replace(/\s+/g, " ").toLowerCase() + " " + s.replace(/\s+/g, "").toLowerCase();
    for (const [g, s] of [["Paracetamol", "650 mg"], ["Azithromycin ", "500MG"], ["Levothyroxine", "50 mcg"], ["Cholecalciferol", "60000 IU"], ["Clobetasol", "0.05 %"]]) {
      expect(compositionOf({ generic: g, strength: s }).saltKey).toBe(sql(g, s));
    }
  });

  it("tokenises searches and forgives typos", () => {
    expect(searchTokens("dolo650")).toEqual(["dolo", "650"]);
    expect(searchTokens("Para 500mg")).toEqual(["para", "500", "mg"]);
    expect(similarity("paracetmol", "Paracetamol")).toBeGreaterThan(0.5);
    expect(similarity("paracetmol", "Pantoprazole")).toBeLessThan(0.3);
  });
});
