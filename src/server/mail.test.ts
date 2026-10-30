import { afterEach, describe, expect, it, vi } from "vitest";
import { mailEnabled, parseFrom, sendMail } from "./mail";

type Call = { url: string; init: RequestInit };
function stubFetch(res: () => Response = () => new Response("{}")) {
  const calls: Call[] = [];
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => { calls.push({ url, init }); return res(); });
  return calls;
}
const hdr = (c: Call) => c.init.headers as Record<string, string>;
const msg = { to: "owner@test.in", subject: "Code 123456", text: "Use 123456" };
const FROM = "Medoro <no-reply@pharmacy.example.in>";

describe("email providers", () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it("resend: bearer key, JSON with from/to/subject/text", async () => {
    const calls = stubFetch(() => Response.json({ id: "e1" }));
    await sendMail(msg, { MAIL_PROVIDER: "resend", RESEND_API_KEY: "re_123", MAIL_FROM: FROM });
    expect(calls[0].url).toBe("https://api.resend.com/emails");
    expect(calls[0].init.method).toBe("POST");
    expect(hdr(calls[0])).toMatchObject({ Authorization: "Bearer re_123", "Content-Type": "application/json" });
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ from: FROM, to: ["owner@test.in"], subject: "Code 123456", text: "Use 123456" });
  });

  it("sendgrid: v3 mail/send with personalizations and a parsed from", async () => {
    const calls = stubFetch(() => new Response(null, { status: 202 }));
    await sendMail(msg, { MAIL_PROVIDER: "sendgrid", SENDGRID_API_KEY: "SG.x", MAIL_FROM: FROM });
    expect(calls[0].url).toBe("https://api.sendgrid.com/v3/mail/send");
    expect(hdr(calls[0]).Authorization).toBe("Bearer SG.x");
    expect(JSON.parse(String(calls[0].init.body))).toEqual({
      personalizations: [{ to: [{ email: "owner@test.in" }] }], from: { name: "Medoro", email: "no-reply@pharmacy.example.in" },
      subject: "Code 123456", content: [{ type: "text/plain", value: "Use 123456" }],
    });
  });

  it("http / smtp-http: POSTs JSON to your relay with a bearer token", async () => {
    const calls = stubFetch();
    for (const p of ["http", "smtp-http"]) await sendMail(msg, { MAIL_PROVIDER: p, MAIL_HTTP_URL: "https://relay.example/mail", MAIL_HTTP_TOKEN: "rt", MAIL_FROM: FROM });
    expect(calls.map((c) => c.url)).toEqual(["https://relay.example/mail", "https://relay.example/mail"]);
    expect(hdr(calls[0]).Authorization).toBe("Bearer rt");
    expect(JSON.parse(String(calls[1].init.body))).toEqual({ from: FROM, to: "owner@test.in", subject: "Code 123456", text: "Use 123456" });
  });

  it("turns a provider failure into a plain message, logging only provider and status", async () => {
    stubFetch(() => new Response('{"message":"bad key"}', { status: 401 }));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(sendMail(msg, { MAIL_PROVIDER: "resend", RESEND_API_KEY: "re_bad", MAIL_FROM: FROM })).rejects.toThrow("Couldn’t send the email, try again.");
    expect(log.mock.calls[0][0]).toBe("[mail] resend send failed: HTTP 401");
  });

  it("console is for development only; enabled needs a provider and MAIL_FROM", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    await expect(sendMail(msg, { MAIL_PROVIDER: "console", NODE_ENV: "production" })).rejects.toThrow(/Couldn’t send/);
    await sendMail(msg, { MAIL_PROVIDER: "console", NODE_ENV: "development" });
    expect(String(info.mock.calls[0][0])).toContain("Use 123456");
    expect(mailEnabled({ MAIL_PROVIDER: "console", NODE_ENV: "production" })).toBe(false);
    expect(mailEnabled({ MAIL_PROVIDER: "resend" })).toBe(false);
    expect(mailEnabled({ MAIL_PROVIDER: "resend", MAIL_FROM: FROM })).toBe(true);
    expect(parseFrom("plain@x.in")).toEqual({ name: undefined, email: "plain@x.in" });
  });
});
