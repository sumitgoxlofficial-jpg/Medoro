import { beforeAll, describe, expect, it } from "vitest";
import { checkLock, clearFailures, lockKeys, recordFailure } from "@/server/auth";
import { resetDb } from "./helpers";

describe("sign-in lockout", () => {
  beforeAll(resetDb);

  it("locks the account after 5 failures without locking others on the same IP", async () => {
    const a = lockKeys("emp:SHOP:E-101", "10.1.1.1"), b = lockKeys("emp:SHOP:E-102", "10.1.1.1");
    for (let i = 4; i >= 1; i--) expect(await recordFailure(a)).toBe(i);
    expect(await recordFailure(a)).toBe(0);
    expect(await checkLock(a)).toBeGreaterThan(0);
    expect(await checkLock(b)).toBe(0);
  });

  it("throttles an IP only after many failures across accounts", async () => {
    const ip = "10.2.2.2";
    for (let i = 0; i < 49; i++) await recordFailure(lockKeys(`acct:u${i}@x.in`, ip));
    expect(await checkLock(lockKeys("acct:fresh@x.in", ip))).toBe(0);
    await recordFailure(lockKeys("acct:u49@x.in", ip));
    expect(await checkLock(lockKeys("acct:fresh@x.in", ip))).toBeGreaterThan(0);
  });

  it("a good sign-in clears the account but not the IP throttle", async () => {
    const k = lockKeys("acct:ok@x.in", "10.3.3.3");
    await recordFailure(k);
    await clearFailures(k);
    expect(await recordFailure(k)).toBe(4);
  });
});
