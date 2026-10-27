import { describe, expect, it } from "vitest";
import { GENESIS, auditHash, verifyChain } from "./audit-hash";

describe("audit hash chain", () => {
  it("detects a tampered row", () => {
    const rows: Parameters<typeof verifyChain>[0] = [];
    let prev = GENESIS;
    for (let i = 0; i < 4; i++) {
      const p = { tenantId: "t", userId: "u", action: "a" + i, entity: "x", entityId: null, detail: null, at: "2026-10-27T00:00:0" + i + "Z" };
      const hash = auditHash(prev, p);
      rows.push({ ...p, prevHash: prev, hash });
      prev = hash;
    }
    expect(verifyChain(rows)).toBe(-1);
    rows[2] = { ...rows[2], detail: "edited" };
    expect(verifyChain(rows)).toBe(2);
  });
});
