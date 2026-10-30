import { describe, expect, it } from "vitest";
import { clientIp, idleLimitMs, lockKeys, maxFails } from "./auth";

const h = (o: Record<string, string>) => new Headers(o);

describe("clientIp", () => {
  const fwd = h({ "x-forwarded-for": "6.6.6.6, 10.0.0.2, 203.0.113.9", "x-real-ip": "203.0.113.9" });

  it("ignores spoofable proxy headers unless a proxy is trusted", () => {
    expect(clientIp(fwd, {})).toBeNull();
  });

  it("uses the hop our own proxy appended", () => {
    expect(clientIp(fwd, { TRUST_PROXY: "1" })).toBe("203.0.113.9");
  });

  it("uses the edge-set address on Vercel", () => {
    expect(clientIp(h({ "x-real-ip": "198.51.100.4", "x-forwarded-for": "198.51.100.4" }), { VERCEL: "1" })).toBe("198.51.100.4");
  });
});

describe("lockKeys", () => {
  it("locks the account quickly and the IP only on volume", () => {
    expect(lockKeys("emp:SHOP:E-101", "1.2.3.4")).toEqual(["emp:SHOP:E-101", "ip:1.2.3.4"]);
    expect(lockKeys("emp:SHOP:E-101", null)).toEqual(["emp:SHOP:E-101"]);
    expect(maxFails("emp:SHOP:E-101")).toBe(5);
    expect(maxFails("ip:1.2.3.4")).toBeGreaterThan(20);
  });
});

describe("idleLimitMs", () => {
  it("ends owner and manager sessions after SESSION_IDLE_MINUTES (2 h by default); counters keep the shift", () => {
    expect(idleLimitMs("Owner", {})).toBe(120 * 60_000);
    expect(idleLimitMs("Manager", { SESSION_IDLE_MINUTES: "30" })).toBe(30 * 60_000);
    expect(idleLimitMs("Manager", { SESSION_IDLE_MINUTES: "nonsense" })).toBe(120 * 60_000);
    expect(idleLimitMs("Cashier", { SESSION_IDLE_MINUTES: "30" })).toBe(12 * 3600_000);
  });
});