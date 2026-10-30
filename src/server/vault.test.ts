import { afterEach, describe, expect, it, vi } from "vitest";
import { seal, unseal } from "./vault";

describe("vault", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("still opens values sealed before HOST_KEY was set (SESSION_SECRET-derived key)", () => {
    vi.stubEnv("SESSION_SECRET", "s".repeat(40));
    vi.stubEnv("HOST_KEY", "");
    const old = seal("wa-token");
    vi.stubEnv("HOST_KEY", "h".repeat(40));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(unseal(old).toString()).toBe("wa-token");
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("seals new values with HOST_KEY, so rotating SESSION_SECRET doesn't lock them", () => {
    vi.stubEnv("SESSION_SECRET", "s".repeat(40));
    vi.stubEnv("HOST_KEY", "h".repeat(40));
    const box = seal("backup-key");
    vi.stubEnv("SESSION_SECRET", "t".repeat(40));
    expect(unseal(box).toString()).toBe("backup-key");
    vi.stubEnv("HOST_KEY", "x".repeat(40));
    expect(() => unseal(box)).toThrow();
  });
});
