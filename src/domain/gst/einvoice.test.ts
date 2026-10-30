import { afterEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { generateKeyPairSync, privateDecrypt, constants, randomBytes } from "node:crypto";
import { aesDecrypt, aesEncrypt, buildEwbByIrnPayload, buildIrnPayload, buildTransferEwbPayload, clearEinvSessions, EInvoiceClient, EinvError, einvConfig, type EinvConfig } from "./einvoice";
import { defaultTallyMap, tallyMastersXml, tallyVouchersXml } from "./tally";
import { IRN_DOC, SELLER_PARTY, TALLY_VOUCHERS } from "./fixtures/einvoice";
import { uqcFor, uqcForLoose } from "./common";

const fixture = (f: string) => readFileSync(path.join(__dirname, "fixtures", f), "utf8").replace(/\r\n/g, "\n");

describe("Tally XML", () => {
  const xml = tallyVouchersXml("Sanjeevani Medical LLP", TALLY_VOUCHERS, defaultTallyMap());

  it("matches the golden import file", () => {
    expect(xml).toBe(fixture("tally-vouchers.xml"));
    expect(tallyMastersXml("Sanjeevani Medical LLP", ["Cash in hand", "Output CGST", "Input IGST", "Electricity", "Mystery account"], defaultTallyMap(),
      [{ ledger: "City Care Hospital", group: "Sundry Debtors", gstin: "29AAGCB7383J1Z4", state: "Karnataka" }, { ledger: "Sai Healthcare", group: "Sundry Creditors" }])).toBe(fixture("tally-masters.xml"));
  });

  it("balances every voucher: debits are deemed positive with negative amounts, credits the reverse", () => {
    const vouchers = [...xml.matchAll(/<VOUCHER VCHTYPE="([^"]+)"[\s\S]*?<\/VOUCHER>/g)];
    expect(vouchers.map((v) => v[1])).toEqual(["Sales", "Sales", "Purchase", "Receipt", "Payment", "Credit Note", "Debit Note", "Journal"]);
    for (const v of vouchers) {
      const entries = [...v[0].matchAll(/<ISDEEMEDPOSITIVE>(Yes|No)<\/ISDEEMEDPOSITIVE><ISPARTYLEDGER>(?:Yes|No)<\/ISPARTYLEDGER><AMOUNT>(-?[\d.]+)<\/AMOUNT>/g)];
      expect(entries.length).toBeGreaterThan(1);
      for (const e of entries) expect(e[1] === "Yes").toBe(Number(e[2]) < 0);
      expect(Math.round(entries.reduce((a, e) => a + Number(e[2]) * 100, 0))).toBe(0);
    }
    expect(xml).not.toContain("<LEDGERNAME>Round Off</LEDGERNAME>"); // zero lines are left out
    expect(xml).toContain("<NARRATION>Sale A/02 &amp; &lt;walk-in&gt;</NARRATION>");
  });
});

describe("e-invoice payloads", () => {
  it("builds the NIC v1.1 invoice JSON", () => {
    const p = buildIrnPayload(IRN_DOC);
    expect(p).toEqual(JSON.parse(fixture("irn-payload.json")));
    const it0 = p.ItemList[0];
    expect(it0.AssAmt).toBeCloseTo(it0.TotAmt - it0.Discount, 2);
    expect(p.ValDtls.TotInvVal).toBeCloseTo(p.ValDtls.AssVal + p.ValDtls.IgstVal + p.ValDtls.RndOffAmt, 2);
    expect(() => buildIrnPayload({ ...IRN_DOC, no: "TMS/MAIN/2627/000001" })).toThrow(/16 characters/);
  });

  it("builds e-way bill payloads", () => {
    expect(buildEwbByIrnPayload("a".repeat(64), { distanceKm: 120, mode: "1", vehicleNo: "KA01 AB 1234", transporterName: "Fast Freight" }))
      .toEqual({ Irn: "a".repeat(64), Distance: 120, TransMode: "1", TransName: "Fast Freight", VehNo: "KA01AB1234", VehType: "R" });
    const t = buildTransferEwbPayload({ no: "TR-0007", date: "2026-10-30", from: SELLER_PARTY, to: { ...SELLER_PARTY, address: "Plot 9, Baner Road, Pune 411045", place: "Baner", pin: 411045 },
      goods: [{ name: "Telma 40 40 mg", hsn: "3004", qty: 300, unit: "PAC", taxable: 4500000, rate: 12, igst: 0, cgst: 0, sgst: 0 }], transport: { distanceKm: 12, mode: "1", vehicleNo: "mh12 ab 1234" } });
    expect(t).toEqual(JSON.parse(fixture("ewb-transfer.json")));
    expect(t).toMatchObject({ supplyType: "O", subSupplyType: "5", docType: "CHL", totInvValue: 45000, vehicleNo: "MH12AB1234" });
  });

  it("is configured only with a provider, credentials and (for NIC) the public key", () => {
    const env = { EINVOICE_PROVIDER: "nic-sandbox", EINVOICE_CLIENT_ID: "c", EINVOICE_CLIENT_SECRET: "s", EINVOICE_USERNAME: "u", EINVOICE_PASSWORD: "p", EINVOICE_GSTIN: "27AAPFU0939F1ZV" };
    expect(einvConfig({})).toBeNull();
    expect(einvConfig(env)).toBeNull();
    expect(einvConfig({ ...env, EINVOICE_PUBLIC_KEY: "k" })).toMatchObject({ provider: "nic-sandbox", baseUrl: "https://einv-apisandbox.nic.in" });
    expect(einvConfig({ ...env, EINVOICE_PROVIDER: "gsp-http" })).toBeNull();
    expect(einvConfig({ ...env, EINVOICE_PROVIDER: "gsp-http", EINVOICE_BASE_URL: "https://gsp.example/api/" })).toMatchObject({ baseUrl: "https://gsp.example/api", publicKey: null });
  });
});

describe("e-invoice client (mocked IRP)", () => {
  afterEach(() => clearEinvSessions());
  const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const pem = publicKey.export({ type: "spki", format: "pem" }).toString();
  const der = publicKey.export({ type: "spki", format: "der" }).toString("base64");
  const rsaOpen = (b64: string) => privateDecrypt({ key: privateKey, padding: constants.RSA_PKCS1_PADDING }, Buffer.from(b64, "base64"));
  const cfg = (over: Partial<EinvConfig> = {}): EinvConfig => ({ provider: "nic-sandbox", baseUrl: "https://irp.test", ewbBaseUrl: "https://ewb.test", clientId: "cid", clientSecret: "csec", username: "medoro", password: "pw", gstin: "27AAPFU0939F1ZV", publicKey: pem, ...over });
  const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });

  /** A fake NIC: checks the encryption at every step and records the decrypted requests. */
  function nic() {
    const sek = randomBytes(32), seen: { path: string; headers: Record<string, string>; body: unknown }[] = [];
    let authCalls = 0, expireNext = false;
    const http = (async (url: string | URL, init?: RequestInit) => {
      const u = new URL(String(url)), headers = init!.headers as Record<string, string>, body = JSON.parse(String(init!.body));
      if (u.pathname === "/eivital/v1.04/auth") {
        authCalls++;
        const creds = JSON.parse(Buffer.from(rsaOpen(body.Data).toString(), "base64").toString());
        seen.push({ path: u.pathname, headers, body: creds });
        if (creds.Password !== "pw") return json({ Status: 0, ErrorDetails: [{ ErrorCode: "1004", ErrorMessage: "Invalid credentials" }] });
        return json({ Status: 1, Data: { ClientId: "cid", UserName: creds.UserName, AuthToken: `tok${authCalls}`, Sek: aesEncrypt(Buffer.from(creds.AppKey, "base64"), sek), TokenExpiry: "2099-12-31 23:59:59" } });
      }
      const payload = JSON.parse(aesDecrypt(sek, body.Data).toString());
      seen.push({ path: u.pathname, headers, body: payload });
      if (expireNext) { expireNext = false; return json({ Status: 0, ErrorDetails: [{ ErrorCode: "1005", ErrorMessage: "Invalid Token" }] }); }
      const reply = (d: unknown) => json({ Status: 1, Data: aesEncrypt(sek, Buffer.from(JSON.stringify(d))) });
      if (u.pathname === "/eicore/v1.03/Invoice") {
        if (payload.DocDtls.No === "DUP/1") return json({ Status: 0, ErrorDetails: [{ ErrorCode: "2150", ErrorMessage: "Duplicate IRN" }] });
        return reply({ AckNo: 112010036563310, AckDt: "2026-10-31 12:30:00", Irn: "f".repeat(64), SignedInvoice: "eyJ.inv", SignedQRCode: "eyJ.qr", Status: "ACT" });
      }
      if (u.pathname === "/eicore/v1.03/Invoice/Cancel") return reply({ Irn: payload.Irn, CancelDate: "2026-10-31 13:00:00" });
      if (u.pathname === "/eiewb/v1.03/ewaybill") return reply({ EwbNo: 331001234567, EwbDt: "2026-10-31 13:05:00", EwbValidTill: "2026-11-01 23:59:00" });
      throw new Error("unexpected " + u.pathname);
    }) as typeof fetch;
    return { http, seen, auths: () => authCalls, expire: () => { expireNext = true; } };
  }

  it("signs in with an RSA-encrypted AppKey, sends SEK-encrypted invoices and decrypts the IRN", async () => {
    const f = nic(), api = new EInvoiceClient(cfg(), f.http);
    const r = await api.generateIrn(buildIrnPayload(IRN_DOC));
    expect(r).toMatchObject({ Irn: "f".repeat(64), AckNo: 112010036563310, SignedQRCode: "eyJ.qr" });
    expect(f.seen[0].body).toMatchObject({ UserName: "medoro", Password: "pw", ForceRefreshAccessToken: false });
    expect(Buffer.from((f.seen[0].body as { AppKey: string }).AppKey, "base64")).toHaveLength(32);
    expect(f.seen[0].headers).toMatchObject({ client_id: "cid", client_secret: "csec", Gstin: "27AAPFU0939F1ZV" });
    expect(f.seen[1].headers).toMatchObject({ AuthToken: "tok1", user_name: "medoro", Gstin: "27AAPFU0939F1ZV" });
    expect(f.seen[1].body).toEqual(buildIrnPayload(IRN_DOC));

    await api.cancelIrn("f".repeat(64), "2", "Wrong rate");
    await expect(api.ewbByIrn(buildEwbByIrnPayload("f".repeat(64), { distanceKm: 0, mode: "1", vehicleNo: "MH12AB1234" }))).resolves.toMatchObject({ EwbNo: 331001234567 });
    expect(f.seen[2].body).toEqual({ Irn: "f".repeat(64), CnlRsn: "2", CnlRem: "Wrong rate" });
    expect(f.auths()).toBe(1); // the session is reused
  });

  it("accepts the public key as base64 DER, re-authenticates on an expired token and reports IRP errors", async () => {
    const f = nic(), api = new EInvoiceClient(cfg({ publicKey: der }), f.http);
    await api.generateIrn(buildIrnPayload(IRN_DOC));
    f.expire();
    await api.generateIrn(buildIrnPayload(IRN_DOC));
    expect(f.auths()).toBe(2);
    await expect(api.generateIrn(buildIrnPayload({ ...IRN_DOC, no: "DUP/1" }))).rejects.toThrow(/2150 Duplicate IRN/);
    clearEinvSessions();
    await expect(new EInvoiceClient(cfg({ password: "bad" }), f.http).generateIrn(buildIrnPayload(IRN_DOC))).rejects.toBeInstanceOf(EinvError);
  });

  it("talks plain JSON to a GSP", async () => {
    const calls: { url: string; headers: Record<string, string>; body: unknown }[] = [];
    const http = (async (url: string | URL, init?: RequestInit) => {
      calls.push({ url: String(url), headers: init!.headers as Record<string, string>, body: JSON.parse(String(init!.body)) });
      if (String(url).endsWith("/ewayapi")) return json({ status: "1", data: { ewayBillNo: 341000000001, ewayBillDate: "30/10/2026 10:00:00 AM", validUpto: "31/10/2026 11:59:00 PM" } });
      return json({ Status: 1, Data: JSON.stringify({ AckNo: 1, AckDt: "2026-10-31 12:30:00", Irn: "e".repeat(64), SignedQRCode: "qr" }) });
    }) as typeof fetch;
    const api = new EInvoiceClient(cfg({ provider: "gsp-http", publicKey: null, baseUrl: "https://gsp.test" }), http);
    expect((await api.generateIrn(buildIrnPayload(IRN_DOC))).Irn).toBe("e".repeat(64));
    expect(calls[0]).toMatchObject({ url: "https://gsp.test/eicore/v1.03/Invoice", headers: { password: "pw", user_name: "medoro" }, body: buildIrnPayload(IRN_DOC) });
    const t = buildTransferEwbPayload({ no: "TR-1", date: "2026-10-30", from: SELLER_PARTY, to: SELLER_PARTY, goods: [], transport: { distanceKm: 5, mode: "1", vehicleNo: "MH12AB1234" } });
    expect(await api.generateEwb(t)).toEqual({ EwbNo: "341000000001", EwbDt: "30/10/2026 10:00:00 AM", EwbValidTill: "31/10/2026 11:59:00 PM" });
    expect(calls[1]).toMatchObject({ url: "https://ewb.test/ewaybillapi/v1.03/ewayapi", body: { action: "GENEWAYBILL", data: t } });
  });

  it("runs the e-way bill API handshake for transfers", async () => {
    const sek = randomBytes(32);
    let decoded: unknown = null;
    const http = (async (url: string | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init!.body));
      if (String(url).endsWith("/auth")) {
        expect(body.action).toBe("ACCESSTOKEN");
        expect(rsaOpen(body.password).toString()).toBe("pw");
        return json({ status: "1", authtoken: "ewbtok", sek: aesEncrypt(rsaOpen(body.app_key), sek) });
      }
      expect((init!.headers as Record<string, string>).authtoken).toBe("ewbtok");
      decoded = JSON.parse(aesDecrypt(sek, body.data).toString());
      return json({ status: "1", data: aesEncrypt(sek, Buffer.from(JSON.stringify({ ewayBillNo: 341000000002, ewayBillDate: "30/10/2026 10:00:00 AM", validUpto: "31/10/2026 11:59:00 PM" }))) });
    }) as typeof fetch;
    const t = buildTransferEwbPayload({ no: "TR-2", date: "2026-10-30", from: SELLER_PARTY, to: SELLER_PARTY, goods: [], transport: { distanceKm: 5, mode: "1", vehicleNo: "MH12AB1234" } });
    expect((await new EInvoiceClient(cfg(), http).generateEwb(t)).EwbNo).toBe("341000000002");
    expect(decoded).toEqual(t);
  });
});

describe("unit codes", () => {
  it("report loose lines per tablet or ml, packs per pack", () => {
    expect(uqcFor("Tablet")).toBe("PAC");
    expect(uqcForLoose("Tablet", "tablet")).toBe("TBS");
    expect(uqcForLoose("Capsule", "capsule")).toBe("TBS");
    expect(uqcForLoose("Syrup", "ml")).toBe("MLT");
    expect(uqcForLoose("Injection", "vial")).toBe("NOS");
    const p = buildIrnPayload({ ...IRN_DOC, items: [{ ...IRN_DOC.items[0], qty: 5, unit: uqcForLoose("Tablet", "tablet") }] });
    expect(p.ItemList[0]).toMatchObject({ Qty: 5, Unit: "TBS", UnitPrice: Math.round(IRN_DOC.items[0].gross / 100 / 5 * 1000) / 1000 });
  });
});
