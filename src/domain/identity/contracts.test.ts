import { describe, expect, it } from "vitest";
import { passwordSchema } from "./contracts";

describe("password rules", () => {
  it("refuses passwords from public breach lists and their obvious variants", () => {
    for (const p of ["1234567890", "Password123", "qwertyuiop", "aaaaaaaaaaaa", "welcome@123", "pharmacy2026!", "3456789012"]) expect(passwordSchema.safeParse(p).success).toBe(false);
    for (const p of ["a-fresh-password", "correct horse battery", "Sanjeevani#Kothrud7"]) expect(passwordSchema.safeParse(p).success).toBe(true);
  });
});
