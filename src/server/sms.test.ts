import { afterEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";
import { parseInbound, sendSms, SmsError, smsEnabled, smsText } from "./sms";

type Call = { url: string; init: RequestInit };
function stubFetch(res: () => Response = () => new Response("{}")) {
  const calls: Call[] = [];
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => { calls.push({ url, init }); return res(); });
  return calls;
}

describe("Customer SMS", () => {
  afterEach(() => vi.unstubAllGlobals());
  const msg = { type: "refill" as const, vars: ["Asha", "Pan 40", "12 Nov"], text: smsText("refill", ["Asha", "Pan 40", "12 Nov"], "Sanjivani") };

  it("msg91 sends the DLT-linked Flow template with var1, var2…; twilio sends the text", async () => {
    let calls = stubFetch(() => Response.json({ type: "success", message: "req-9" }));
    await expect(sendSms("9822041736", msg, { SMS_PROVIDER: "msg91", OTP_API_KEY: "k" })).rejects.toThrow(/template id/);
    expect(await sendSms("9822041736", { ...msg, template: "flow-1" }, { SMS_PROVIDER: "msg91", OTP_API_KEY: "k", OTP_SENDER: "MEDORO" })).toBe("req-9");
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ template_id: "flow-1", short_url: "0", sender: "MEDORO", recipients: [{ mobiles: "919822041736", var1: "Asha", var2: "Pan 40", var3: "12 Nov" }] });
    calls = stubFetch(() => Response.json({ sid: "SM1" }));
    expect(await sendSms("9822041736", msg, { OTP_PROVIDER: "twilio", TWILIO_ACCOUNT_SID: "AC1", TWILIO_AUTH_TOKEN: "t", TWILIO_FROM: "+15550001111" })).toBe("SM1");
    expect(new URLSearchParams(String(calls[0].init.body)).get("Body")).toMatch(/^Hi Asha, your Pan 40 may be running out around 12 Nov\. Visit Sanjivani to refill\. Reply STOP to opt out\.$/);
  });

  it("gateway outages are retryable, rejections are not", async () => {
    stubFetch(() => new Response("busy", { status: 503 }));
    await expect(sendSms("9822041736", msg, { OTP_PROVIDER: "http", OTP_HTTP_URL: "https://sms.example" })).rejects.toMatchObject({ retry: true });
    stubFetch(() => new Response("{}", { status: 400 }));
    const e = await sendSms("9822041736", msg, { OTP_PROVIDER: "http", OTP_HTTP_URL: "https://sms.example" }).catch((x) => x);
    expect(e).toBeInstanceOf(SmsError);
    expect(e.retry).toBe(false);
  });

  it("accepts inbound Twilio messages only with a valid signature", () => {
    const env = { SMS_PROVIDER: "twilio", TWILIO_AUTH_TOKEN: "tw-token", APP_URL: "https://pharmacy.example.in/" };
    const body = new URLSearchParams({ From: "+919822041736", Body: "STOP", To: "+15550001111" }).toString();
    const sig = createHmac("sha1", "tw-token").update("https://pharmacy.example.in/api/sms/inbound" + "BodySTOP" + "From+919822041736" + "To+15550001111").digest("base64");
    expect(parseInbound(body, new Headers({ "x-twilio-signature": sig }), env)).toEqual({ from: "+919822041736", text: "STOP" });
    expect(parseInbound(body, new Headers({ "x-twilio-signature": Buffer.alloc(20).toString("base64") }), env)).toBeNull();
    expect(parseInbound(body, new Headers(), { ...env, SMS_PROVIDER: "msg91" })).toBeNull();
  });
});

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
