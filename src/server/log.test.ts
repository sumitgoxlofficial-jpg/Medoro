import { afterEach, describe, expect, it, vi } from "vitest";
import { format, log, redact } from "./log";

describe("structured logger", () => {
  afterEach(() => { vi.restoreAllMocks(); delete process.env.LOG_LEVEL; });

  it("redacts sensitive keys at any depth", () => {
    const out = redact({ user: { email: "a@b.in", phone: "9822000001", name: "A" }, headers: { authorization: "Bearer x", Cookie: "s=1" }, otp: "123456", code: "999999", password: "pw", sessionToken: "t", ok: 1n }) as Record<string, Record<string, unknown>>;
    expect(out.user).toEqual({ email: "[redacted]", phone: "[redacted]", name: "A" });
    expect(out.headers).toEqual({ authorization: "[redacted]", Cookie: "[redacted]" });
    expect(out).toMatchObject({ otp: "[redacted]", code: "[redacted]", password: "[redacted]", sessionToken: "[redacted]", ok: "1" });
  });

  it("writes one JSON line and honours LOG_LEVEL", () => {
    const line = JSON.parse(format("info", "hello", { err: new Error("boom"), secret: "s" }));
    expect(line).toMatchObject({ level: "info", msg: "hello", secret: "[redacted]", err: { name: "Error", message: "boom" } });
    const out = vi.spyOn(console, "log").mockImplementation(() => {});
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    process.env.LOG_LEVEL = "warn";
    log.info("skip");
    log.warn("kept", { token: "t" });
    expect(out).not.toHaveBeenCalled();
    expect(JSON.parse(err.mock.calls[0][0] as string)).toMatchObject({ level: "warn", msg: "kept", token: "[redacted]" });
  });
});
