import { createCipheriv, createDecipheriv, createPublicKey, publicEncrypt, randomBytes, constants, type KeyObject } from "node:crypto";
import { rs, dmy } from "./common";

// E-invoice (IRN) and e-way bill client for the NIC IRP, direct or through a GSP.
// Payload: e-invoice schema INV-01 version 1.1 (NIC API v1.03). Auth: NIC API v1.04 (AppKey + SEK).

export type EinvProvider = "nic-sandbox" | "nic" | "gsp-http";
export type EinvConfig = { provider: EinvProvider; baseUrl: string; ewbBaseUrl: string; clientId: string; clientSecret: string; username: string; password: string; gstin: string; publicKey: string | null };

const BASE: Record<string, string> = { "nic-sandbox": "https://einv-apisandbox.nic.in", nic: "https://einvapi.gst.gov.in" };

/** Reads EINVOICE_* settings. null when e-invoicing isn't configured on this server. */
export function einvConfig(env: Record<string, string | undefined> = process.env): EinvConfig | null {
  const provider = env.EINVOICE_PROVIDER as EinvProvider | undefined;
  if (!provider || !["nic-sandbox", "nic", "gsp-http"].includes(provider)) return null;
  const baseUrl = (env.EINVOICE_BASE_URL || BASE[provider] || "").replace(/\/+$/, "");
  const need = { baseUrl, clientId: env.EINVOICE_CLIENT_ID, clientSecret: env.EINVOICE_CLIENT_SECRET, username: env.EINVOICE_USERNAME, password: env.EINVOICE_PASSWORD, gstin: env.EINVOICE_GSTIN };
  if (Object.values(need).some((v) => !v)) return null;
  const publicKey = env.EINVOICE_PUBLIC_KEY || null;
  if (provider !== "gsp-http" && !publicKey) return null;
  return { provider, ...(need as Record<keyof typeof need, string>), ewbBaseUrl: (env.EWAYBILL_BASE_URL || baseUrl).replace(/\/+$/, ""), publicKey };
}

// ───────────── Payloads ─────────────

export type EinvParty = { gstin: string; legalName: string; tradeName?: string; address: string; place: string; pin: number; stateCode: string; phone?: string | null; email?: string | null };
export type EinvItem = { name: string; hsn: string; qty: number; unit: string; batch?: string; expiry?: string; rate: number; gross: number; taxable: number; igst: number; cgst: number; sgst: number };
export type EinvDoc = { type: "INV" | "CRN" | "DBN"; no: string; date: string; seller: EinvParty; buyer: EinvParty & { pos: string }; items: EinvItem[]; roundOff: number };

const r3 = (n: number) => Math.round(n * 1000) / 1000;
const phone = (p?: string | null) => (p ? p.replace(/\D/g, "").slice(-10) || undefined : undefined);

function party(p: EinvParty) {
  return {
    Gstin: p.gstin, LglNm: p.legalName.slice(0, 100), ...(p.tradeName ? { TrdNm: p.tradeName.slice(0, 100) } : {}),
    Addr1: p.address.slice(0, 100), Loc: p.place.slice(0, 50), Pin: p.pin, Stcd: p.stateCode,
    ...(phone(p.phone) ? { Ph: phone(p.phone) } : {}), ...(p.email ? { Em: p.email.slice(0, 100) } : {}),
  };
}

/** Amounts are paise in, rupees out. TotAmt is the pre-tax value before discount; AssAmt = TotAmt − Discount. */
export function buildIrnPayload(d: EinvDoc) {
  if (!/^[1-9A-Z][0-9A-Z/-]{0,15}$/.test(d.no)) throw new Error(`Document number ${d.no} must be 1–16 characters (A–Z, 0–9, / and -) and not start with 0, / or -.`);
  const items = d.items.map((it, i) => {
    const disc = it.gross - it.taxable;
    return {
      SlNo: String(i + 1), PrdDesc: it.name.slice(0, 300), IsServc: "N", HsnCd: it.hsn, Qty: it.qty, Unit: it.unit,
      UnitPrice: r3(it.gross / 100 / it.qty), TotAmt: rs(it.gross), Discount: rs(disc), AssAmt: rs(it.taxable), GstRt: it.rate,
      IgstAmt: rs(it.igst), CgstAmt: rs(it.cgst), SgstAmt: rs(it.sgst), CesRt: 0, CesAmt: 0, CesNonAdvlAmt: 0, StateCesRt: 0, StateCesAmt: 0, StateCesNonAdvlAmt: 0, OthChrg: 0,
      TotItemVal: rs(it.taxable + it.igst + it.cgst + it.sgst),
      ...(it.batch ? { BchDtls: { Nm: it.batch.slice(0, 20), ...(it.expiry ? { ExpDt: dmy(it.expiry, "/") } : {}) } } : {}),
    };
  });
  const sum = (f: (x: EinvItem) => number) => d.items.reduce((a, x) => a + f(x), 0);
  const total = sum((x) => x.taxable + x.igst + x.cgst + x.sgst) + d.roundOff;
  return {
    Version: "1.1",
    TranDtls: { TaxSch: "GST", SupTyp: "B2B", RegRev: "N", IgstOnIntra: "N" },
    DocDtls: { Typ: d.type, No: d.no, Dt: dmy(d.date, "/") },
    SellerDtls: party(d.seller),
    BuyerDtls: { ...party(d.buyer), Pos: d.buyer.pos },
    ItemList: items,
    ValDtls: { AssVal: rs(sum((x) => x.taxable)), CgstVal: rs(sum((x) => x.cgst)), SgstVal: rs(sum((x) => x.sgst)), IgstVal: rs(sum((x) => x.igst)), CesVal: 0, StCesVal: 0, Discount: 0, OthChrg: 0, RndOffAmt: rs(d.roundOff), TotInvVal: rs(total) },
  };
}

export type Transport = { distanceKm: number; mode: "1" | "2" | "3" | "4"; vehicleNo?: string; vehicleType?: "R" | "O"; transporterId?: string; transporterName?: string; transDocNo?: string; transDocDate?: string };

const vehicle = (v?: string) => (v ? v.toUpperCase().replace(/[^A-Z0-9]/g, "") : undefined);
export const VEHICLE_RE = /^[A-Z]{2}[0-9]{1,2}[A-Z]{0,3}[0-9]{4}$|^TM[A-Z0-9]{6}$|^DF[A-Z0-9]{6}$|^TR[A-Z0-9]{6,13}$|^BP[A-Z0-9]{6}$|^NP[A-Z0-9]{6}$/;

/** E-way bill against an IRN (NIC e-invoice API: /eiewb/v1.03/ewaybill). */
export function buildEwbByIrnPayload(irn: string, t: Transport) {
  return {
    Irn: irn, Distance: Math.round(t.distanceKm), TransMode: t.mode,
    ...(t.transporterId ? { TransId: t.transporterId } : {}), ...(t.transporterName ? { TransName: t.transporterName.slice(0, 100) } : {}),
    ...(t.transDocNo ? { TransDocNo: t.transDocNo.slice(0, 15) } : {}), ...(t.transDocDate ? { TransDocDt: dmy(t.transDocDate, "/") } : {}),
    ...(vehicle(t.vehicleNo) ? { VehNo: vehicle(t.vehicleNo), VehType: t.vehicleType ?? "R" } : {}),
  };
}

export type EwbGoods = { name: string; hsn: string; qty: number; unit: string; taxable: number; rate: number; igst: number; cgst: number; sgst: number };

/**
 * E-way bill without an invoice (NIC e-way bill API, action GENEWAYBILL): a delivery challan for stock moved
 * between branches. Same GSTIN: supply type Outward, sub-type "For own use" (5). Different GSTINs: a supply (1)
 * and taxes as charged.
 */
export function buildTransferEwbPayload(d: { no: string; date: string; from: EinvParty; to: EinvParty; goods: EwbGoods[]; transport: Transport }) {
  const own = d.from.gstin === d.to.gstin;
  const sum = (f: (g: EwbGoods) => number) => d.goods.reduce((a, g) => a + f(g), 0);
  const p = (x: EinvParty, side: "from" | "to") => ({
    [`${side}Gstin`]: x.gstin, [`${side}TrdName`]: x.legalName.slice(0, 100), [`${side}Addr1`]: x.address.slice(0, 120), [`${side}Place`]: x.place.slice(0, 50),
    [`${side}Pincode`]: x.pin, [`act${side === "from" ? "From" : "To"}StateCode`]: Number(x.stateCode), [`${side}StateCode`]: Number(x.stateCode),
  });
  return {
    supplyType: "O", subSupplyType: own ? "5" : "1", ...(own ? { subSupplyDesc: "" } : {}), docType: own ? "CHL" : "INV", docNo: d.no, docDate: dmy(d.date, "/"),
    ...p(d.from, "from"), ...p(d.to, "to"), transactionType: 1,
    totalValue: rs(sum((g) => g.taxable)), cgstValue: rs(sum((g) => g.cgst)), sgstValue: rs(sum((g) => g.sgst)), igstValue: rs(sum((g) => g.igst)), cessValue: 0, cessNonAdvolValue: 0, otherValue: 0,
    totInvValue: rs(sum((g) => g.taxable + g.igst + g.cgst + g.sgst)),
    transMode: d.transport.mode, transDistance: String(Math.round(d.transport.distanceKm)),
    ...(d.transport.transporterId ? { transporterId: d.transport.transporterId } : {}), ...(d.transport.transporterName ? { transporterName: d.transport.transporterName.slice(0, 100) } : {}),
    ...(d.transport.transDocNo ? { transDocNo: d.transport.transDocNo.slice(0, 15) } : {}), ...(d.transport.transDocDate ? { transDocDate: dmy(d.transport.transDocDate, "/") } : {}),
    ...(vehicle(d.transport.vehicleNo) ? { vehicleNo: vehicle(d.transport.vehicleNo), vehicleType: d.transport.vehicleType ?? "R" } : {}),
    itemList: d.goods.map((g, i) => ({
      itemNo: i + 1, productName: g.name.slice(0, 100), productDesc: g.name.slice(0, 100), hsnCode: Number(g.hsn), quantity: g.qty, qtyUnit: g.unit,
      taxableAmount: rs(g.taxable), cgstRate: g.cgst ? g.rate / 2 : 0, sgstRate: g.sgst ? g.rate / 2 : 0, igstRate: g.igst ? g.rate : 0, cessRate: 0, cessNonadvol: 0,
    })),
  };
}

// ───────────── Crypto (NIC: RSA PKCS#1 v1.5 with the IRP public key; AES-256-ECB with PKCS#7 padding) ─────────────

function keyOf(pub: string): KeyObject {
  const s = pub.trim();
  if (s.startsWith("-----BEGIN")) return createPublicKey(s);
  return createPublicKey({ key: Buffer.from(s.replace(/\s+/g, ""), "base64"), format: "der", type: "spki" });
}
export const rsaEncrypt = (pub: string, data: Buffer) => publicEncrypt({ key: keyOf(pub), padding: constants.RSA_PKCS1_PADDING }, data).toString("base64");
export function aesEncrypt(key: Buffer, data: Buffer) {
  const c = createCipheriv("aes-256-ecb", key, null);
  return Buffer.concat([c.update(data), c.final()]).toString("base64");
}
export function aesDecrypt(key: Buffer, b64: string) {
  const d = createDecipheriv("aes-256-ecb", key, null);
  return Buffer.concat([d.update(Buffer.from(b64, "base64")), d.final()]);
}
/** Decrypted response data is the JSON itself, or (some versions) its base64. */
function jsonOf(buf: Buffer): Record<string, unknown> {
  const s = buf.toString("utf8");
  try { return JSON.parse(s); } catch { return JSON.parse(Buffer.from(s, "base64").toString("utf8")); }
}

// ───────────── Client ─────────────

export class EinvError extends Error {
  constructor(message: string, readonly details: unknown = null) { super(message); }
}

type Session = { token: string; sek: Buffer; expires: number };
const sessions = new Map<string, Session>();
export const clearEinvSessions = () => sessions.clear();

export type IrnResult = { Irn: string; AckNo: string; AckDt: string; SignedInvoice?: string; SignedQRCode: string; EwbNo?: string | null; EwbDt?: string | null; EwbValidTill?: string | null };
export type EwbResult = { EwbNo: string; EwbDt: string; EwbValidTill: string };

function errorText(body: Record<string, unknown>): string {
  const list = (body.ErrorDetails ?? body.error ?? body.errorDetails) as unknown;
  if (Array.isArray(list)) return list.map((e) => `${(e as { ErrorCode?: string }).ErrorCode ?? ""} ${(e as { ErrorMessage?: string }).ErrorMessage ?? ""}`.trim()).join("; ");
  if (typeof list === "string") { try { const e = JSON.parse(Buffer.from(list, "base64").toString("utf8")); return e.errorCodes ? `E-way bill error ${e.errorCodes}` : list; } catch { return list; } }
  return (body.message as string) ?? "The IRP rejected the request.";
}

export class EInvoiceClient {
  constructor(private cfg: EinvConfig, private http: typeof fetch = fetch) {}

  private headers(extra: Record<string, string> = {}) {
    const c = this.cfg;
    return { "Content-Type": "application/json", Accept: "application/json", client_id: c.clientId, client_secret: c.clientSecret, Gstin: c.gstin, user_name: c.username, ...(c.provider === "gsp-http" ? { password: c.password } : {}), ...extra };
  }

  private async post(url: string, headers: Record<string, string>, body: unknown): Promise<Record<string, unknown>> {
    const res = await this.http(url, { method: "POST", headers, body: JSON.stringify(body), signal: AbortSignal.timeout(30_000) });
    const text = await res.text();
    let json: Record<string, unknown>;
    try { json = JSON.parse(text); } catch { throw new EinvError(`The e-invoice service returned HTTP ${res.status}.`, text.slice(0, 500)); }
    if (!res.ok && json.Status === undefined && json.status === undefined) throw new EinvError(`The e-invoice service returned HTTP ${res.status}.`, json);
    return json;
  }

  /** NIC v1.04 auth: {UserName, Password, AppKey, ForceRefreshAccessToken} → base64 → RSA. The SEK comes back AES-encrypted with the AppKey. */
  async session(force = false): Promise<Session> {
    const c = this.cfg, key = `${c.provider}|${c.baseUrl}|${c.gstin}|${c.username}`;
    const cached = sessions.get(key);
    if (cached && !force && cached.expires > Date.now() + 60_000) return cached;
    const appKey = randomBytes(32);
    const plain = JSON.stringify({ UserName: c.username, Password: c.password, AppKey: appKey.toString("base64"), ForceRefreshAccessToken: force });
    const body = await this.post(`${c.baseUrl}/eivital/v1.04/auth`, { "Content-Type": "application/json", client_id: c.clientId, client_secret: c.clientSecret, Gstin: c.gstin },
      { Data: rsaEncrypt(c.publicKey!, Buffer.from(Buffer.from(plain).toString("base64"))) });
    if (String(body.Status) !== "1") throw new EinvError(`E-invoice sign-in failed: ${errorText(body)}`, body);
    const data = (typeof body.Data === "string" ? jsonOf(aesDecrypt(appKey, body.Data)) : body.Data) as { AuthToken: string; Sek: string; TokenExpiry?: string };
    const expiry = data.TokenExpiry ? Date.parse(data.TokenExpiry.replace(" ", "T") + "+05:30") : NaN;
    const s = { token: data.AuthToken, sek: aesDecrypt(appKey, data.Sek), expires: Number.isFinite(expiry) ? expiry : Date.now() + 50 * 60_000 };
    sessions.set(key, s);
    return s;
  }

  /** Calls an IRP endpoint: plain JSON for a GSP, SEK-encrypted Data for NIC. Retries once on an expired token. */
  private async call<T>(path: string, payload: unknown, retry = true): Promise<T> {
    const c = this.cfg;
    if (c.provider === "gsp-http") {
      const body = await this.post(`${c.baseUrl}${path}`, this.headers(), payload);
      if (String(body.Status ?? body.status) !== "1") throw new EinvError(errorText(body), body);
      return (typeof body.Data === "string" ? JSON.parse(body.Data) : body.Data) as T;
    }
    const s = await this.session();
    const body = await this.post(`${c.baseUrl}${path}`, this.headers({ AuthToken: s.token }), { Data: aesEncrypt(s.sek, Buffer.from(JSON.stringify(payload))) });
    if (String(body.Status) !== "1") {
      const msg = errorText(body);
      if (retry && /1005|token/i.test(msg)) { await this.session(true); return this.call(path, payload, false); }
      throw new EinvError(msg, body);
    }
    return jsonOf(aesDecrypt(s.sek, body.Data as string)) as T;
  }

  generateIrn(payload: ReturnType<typeof buildIrnPayload>) { return this.call<IrnResult>("/eicore/v1.03/Invoice", payload); }
  /** Reasons: 1 duplicate, 2 data entry mistake, 3 order cancelled, 4 others. Allowed within 24 hours of the IRN. */
  cancelIrn(irn: string, reason: "1" | "2" | "3" | "4", remark: string) { return this.call<{ Irn: string; CancelDate: string }>("/eicore/v1.03/Invoice/Cancel", { Irn: irn, CnlRsn: reason, CnlRem: remark.slice(0, 100) }); }
  ewbByIrn(payload: ReturnType<typeof buildEwbByIrnPayload>) { return this.call<EwbResult>("/eiewb/v1.03/ewaybill", payload); }

  /** E-way bill API (separate from the IRP): ACCESSTOKEN with RSA-encrypted password and app key, then GENEWAYBILL. */
  async generateEwb(payload: ReturnType<typeof buildTransferEwbPayload>): Promise<EwbResult> {
    const c = this.cfg, base = `${c.ewbBaseUrl}/ewaybillapi/v1.03`;
    const h = { "Content-Type": "application/json", "client-id": c.clientId, "client-secret": c.clientSecret, gstin: c.gstin };
    let res: Record<string, unknown>;
    if (c.provider === "gsp-http") {
      res = await this.post(`${base}/ewayapi`, { ...h, username: c.username, password: c.password }, { action: "GENEWAYBILL", data: payload });
      if (String(res.status ?? res.Status) !== "1") throw new EinvError(`E-way bill failed: ${errorText(res)}`, res);
      const d = (typeof res.data === "string" ? JSON.parse(res.data) : res.data) as { ewayBillNo: number | string; ewayBillDate: string; validUpto: string };
      return { EwbNo: String(d.ewayBillNo), EwbDt: d.ewayBillDate, EwbValidTill: d.validUpto };
    }
    const appKey = randomBytes(32);
    const auth = await this.post(`${base}/auth`, h, { action: "ACCESSTOKEN", username: c.username, password: rsaEncrypt(c.publicKey!, Buffer.from(c.password)), app_key: rsaEncrypt(c.publicKey!, appKey) });
    if (String(auth.status) !== "1") throw new EinvError(`E-way bill sign-in failed: ${errorText(auth)}`, auth);
    const sek = aesDecrypt(appKey, auth.sek as string);
    res = await this.post(`${base}/ewayapi`, { ...h, authtoken: String(auth.authtoken) }, { action: "GENEWAYBILL", data: aesEncrypt(sek, Buffer.from(JSON.stringify(payload))) });
    if (String(res.status) !== "1") throw new EinvError(`E-way bill failed: ${errorText(res)}`, res);
    const d = jsonOf(aesDecrypt(sek, res.data as string)) as { ewayBillNo: number | string; ewayBillDate: string; validUpto: string };
    return { EwbNo: String(d.ewayBillNo), EwbDt: d.ewayBillDate, EwbValidTill: d.validUpto };
  }
}
