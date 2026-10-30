import { afterEach, describe, expect, it, vi } from "vitest";
import { sendSms, smsEnabled } from "./sms";

type Call = { url: string; init: RequestInit };
function stubFetch(res: () => Response = () => new Response("{}")) {
  const calls: Call[] = [];
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => { calls.push({ url, init }); return res(); });
  return calls;
}

describe("order SMS", () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it("uses SMS_PROVIDER, falling back to OTP_PROVIDER; msg91 needs its own text template", () => {
    expect(smsEnabled({})).toBe(false);
    expect(smsEnabled({ OTP_PROVIDER: "console", NODE_ENV: "production" })).toBe(false);
    expect(smsEnabled({ OTP_PROVIDER: "msg91", OTP_API_KEY: "k", OTP_TEMPLATE_ID: "otp" })).toBe(false);
    expect(smsEnabled({ OTP_PROVIDER: "msg91", OTP_API_KEY: "k", SMS_TEMPLATE_ID: "t" })).toBe(true);
    expect(smsEnabled({ OTP_PROVIDER: "msg91", SMS_PROVIDER: "http", SMS_HTTP_URL: "https://x" })).toBe(true);
  });

  it("msg91 sends the text as a Flow variable; twilio posts Body; http posts JSON", async () => {
    const calls = stubFetch(() => Response.json({ type: "success" }));
    await sendSms("98220 11122", "Order out", { SMS_PROVIDER: "msg91", OTP_API_KEY: "k", SMS_TEMPLATE_ID: "tpl" });
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ template_id: "tpl", short_url: "0", recipients: [{ mobiles: "919822011122", text: "Order out" }] });
    await sendSms("9822011122", "Hi", { SMS_PROVIDER: "twilio", TWILIO_ACCOUNT_SID: "AC1", TWILIO_AUTH_TOKEN: "t", TWILIO_FROM: "+15550001111" });
    expect(new URLSearchParams(String(calls[1].init.body)).get("Body")).toBe("Hi");
    await sendSms("9822011122", "Hey", { OTP_PROVIDER: "http", OTP_HTTP_URL: "https://hook.example/sms", OTP_HTTP_TOKEN: "tok" });
    expect(calls[2].url).toBe("https://hook.example/sms");
    expect(JSON.parse(String(calls[2].init.body))).toEqual({ phone: "+919822011122", purpose: "message", text: "Hey" });
  });

  it("fails loudly when the gateway rejects or nothing is configured", async () => {
    stubFetch(() => new Response("no", { status: 500 }));
    await expect(sendSms("9822011122", "x", { SMS_PROVIDER: "http", SMS_HTTP_URL: "https://x" })).rejects.toThrow(/HTTP 500/);
    await expect(sendSms("9822011122", "x", {})).rejects.toThrow(/not configured/);
  });
});
