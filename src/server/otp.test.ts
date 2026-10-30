import { afterEach, describe, expect, it, vi } from "vitest";
import { deliverSms, otpEnabled, toE164 } from "./otp";

type Call = { url: string; init: RequestInit };
function stubFetch(res: () => Response = () => new Response("{}")) {
  const calls: Call[] = [];
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => { calls.push({ url, init }); return res(); });
  return calls;
}
const hdr = (c: Call) => c.init.headers as Record<string, string>;

describe("SMS OTP providers", () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it("normalises Indian mobiles to E.164", () => {
    for (const p of ["9822041736", "098220 41736", "+91 98220-41736", "919822041736"]) expect(toE164(p)).toBe("+919822041736");
    expect(() => toE164("12345")).toThrow(/10-digit/);
  });

  it("msg91: Flow API with authkey header, template and the code as the otp variable", async () => {
    const calls = stubFetch(() => Response.json({ type: "success", message: "3567" }));
    await deliverSms("9822041736", "123456", "signin", 5, { OTP_PROVIDER: "msg91", OTP_API_KEY: "k-91", OTP_TEMPLATE_ID: "tpl-1", OTP_SENDER: "MEDORO" });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://control.msg91.com/api/v5/flow");
    expect(calls[0].init.method).toBe("POST");
    expect(hdr(calls[0])).toMatchObject({ authkey: "k-91", "Content-Type": "application/json" });
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ template_id: "tpl-1", short_url: "0", sender: "MEDORO", recipients: [{ mobiles: "919822041736", otp: "123456", minutes: "5" }] });
  });

  it("msg91: a 200 with type=error is a failed send", async () => {
    stubFetch(() => Response.json({ type: "error", message: "Invalid template" }));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(deliverSms("9822041736", "123456", "signin", 5, { OTP_PROVIDER: "msg91", OTP_API_KEY: "k", OTP_TEMPLATE_ID: "t" })).rejects.toThrow("Couldn’t send the code, try again.");
    expect(String(log.mock.calls[0][0])).toMatch(/msg91 send failed: rejected/);
    expect(String(log.mock.calls[0][0])).not.toContain("123456");
  });

  it("twilio: Messages API with basic auth, form body and From number or messaging service", async () => {
    const calls = stubFetch(() => Response.json({ sid: "SM1" }, { status: 201 }));
    const env = { OTP_PROVIDER: "twilio", TWILIO_ACCOUNT_SID: "AC123", TWILIO_AUTH_TOKEN: "tok", TWILIO_FROM: "+15005550006" };
    await deliverSms("9822041736", "654321", "reset", 15, env);
    expect(calls[0].url).toBe("https://api.twilio.com/2010-04-01/Accounts/AC123/Messages.json");
    expect(hdr(calls[0]).Authorization).toBe("Basic " + Buffer.from("AC123:tok").toString("base64"));
    expect(hdr(calls[0])["Content-Type"]).toBe("application/x-www-form-urlencoded");
    const body = new URLSearchParams(String(calls[0].init.body));
    expect(body.get("To")).toBe("+919822041736");
    expect(body.get("From")).toBe("+15005550006");
    expect(body.get("Body")).toMatch(/^654321 is your Medoro password reset code\. It expires in 15 minutes/);
    await deliverSms("9822041736", "654321", "reset", 15, { ...env, TWILIO_FROM: "MG0001" });
    expect(new URLSearchParams(String(calls[1].init.body)).get("MessagingServiceSid")).toBe("MG0001");
  });

  it("http: POSTs {phone, code, purpose} JSON with a bearer token", async () => {
    const calls = stubFetch();
    await deliverSms("9822041736", "111222", "invite", 5, { OTP_PROVIDER: "http", OTP_HTTP_URL: "https://sms.example/send", OTP_HTTP_TOKEN: "secret-t" });
    expect(calls[0].url).toBe("https://sms.example/send");
    expect(hdr(calls[0])).toMatchObject({ Authorization: "Bearer secret-t", "Content-Type": "application/json" });
    expect(JSON.parse(String(calls[0].init.body))).toMatchObject({ phone: "+919822041736", code: "111222", purpose: "invite" });
  });

  it("surfaces a provider error as a plain message and logs only the status", async () => {
    stubFetch(() => new Response("upstream down", { status: 503 }));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(deliverSms("9822041736", "999000", "signin", 5, { OTP_PROVIDER: "http", OTP_HTTP_URL: "https://sms.example/send" })).rejects.toThrow("Couldn’t send the code, try again.");
    expect(log.mock.calls[0][0]).toBe("[otp] http send failed: HTTP 503");
  });

  it("refuses a missing key, an unknown provider and the console provider in production", async () => {
    const calls = stubFetch();
    vi.spyOn(console, "error").mockImplementation(() => {});
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    await expect(deliverSms("9822041736", "1", "signin", 5, { OTP_PROVIDER: "msg91", OTP_TEMPLATE_ID: "t" })).rejects.toThrow(/Couldn’t send/);
    await expect(deliverSms("9822041736", "1", "signin", 5, { OTP_PROVIDER: "carrier-pigeon" })).rejects.toThrow(/Couldn’t send/);
    await expect(deliverSms("9822041736", "1", "signin", 5, { OTP_PROVIDER: "console", NODE_ENV: "production" })).rejects.toThrow(/Couldn’t send/);
    expect(calls).toHaveLength(0);
    expect(info).not.toHaveBeenCalled();
    await deliverSms("9822041736", "424242", "signin", 5, { OTP_PROVIDER: "console", NODE_ENV: "development" });
    expect(String(info.mock.calls[0][0])).toContain("424242");
    expect(otpEnabled({ OTP_PROVIDER: "console", NODE_ENV: "production" })).toBe(false);
    expect(otpEnabled({ OTP_PROVIDER: "msg91" })).toBe(true);
    expect(otpEnabled({})).toBe(false);
  });
});
