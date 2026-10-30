import { describe, expect, it } from "vitest";
import { DEFAULT_GRANTS, effectivePerms } from "./permissions";

describe("effectivePerms", () => {
  it("adds per-user grants and removes per-user revokes, in a stable order", () => {
    expect(effectivePerms(DEFAULT_GRANTS.Cashier, ["reports", "credit"], [])).toEqual(["sale", "credit", "reports"]);
    expect(effectivePerms(DEFAULT_GRANTS.Pharmacist, [], ["disc"])).toEqual(["sale", "adjust"]);
    expect(effectivePerms(DEFAULT_GRANTS.Cashier, ["sale"], ["sale"])).toEqual([]);
  });

  it("ignores unknown permission keys", () => {
    expect(effectivePerms(["sale", "superuser"], ["root"], ["nothing"])).toEqual(["sale"]);
  });
});
