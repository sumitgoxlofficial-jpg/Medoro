"use server";
import { distRun, formObject } from "./_lib/run";
import * as M from "@/domain/distribution/masters";
import * as O from "@/domain/distribution/orders";
import * as B from "@/domain/distribution/billing";
import * as R from "@/domain/distribution/returns";
import * as D from "@/domain/distribution/dispatch";
import * as I from "@/domain/distribution/intelligence";
import * as P from "@/domain/distribution/portal";
import * as U from "@/domain/distribution/admin";
import { acknowledgeClaim, creditClaim } from "@/domain/inventory/claims";
import { approveTransfer, cancelTransfer, receiveTransfer, rejectTransfer, requestTransfer, adjustStock } from "@/domain/inventory/adjust";
import { approveSupplierInvoice, createPo, setPoStatus } from "@/domain/purchasing/service";
import { saveSupplier } from "@/domain/parties/service";
import { importBankStatement, matchBankLine, unmatchBankLine } from "@/domain/accounting/bank";
import { depositCheque, clearCheque, bounceCheque } from "@/domain/parties/cheques";
import { distAuthorize } from "@/domain/distribution/context";
import { UserError } from "@/server/action";
import { db } from "@/server/db";
import type { GrnInput, PoInput } from "@/domain/purchasing/contracts";

const id = (fd: FormData, k = "id") => (String(fd.get(k) ?? "") || null);
const bool = (fd: FormData, k: string) => fd.get(k) === "on" || fd.get(k) === "true";

// ───────────── Masters ─────────────
export async function saveCompanyAction(fd: FormData) { return distRun((c) => M.saveCompany(c, id(fd), { ...formObject(fd), active: !bool(fd, "inactive") } as never), "Company saved."); }
export async function savePrincipalAction(fd: FormData) { return distRun((c) => M.savePrincipal(c, id(fd), { ...formObject(fd), active: !bool(fd, "inactive") } as never), "Principal saved."); }
export async function saveProductAction(fd: FormData) {
  const o = formObject(fd);
  return distRun((c) => M.saveProduct(c, id(fd), { ...o, portalVisible: bool(fd, "portalVisible"), discontinued: bool(fd, "discontinued") } as never, o.version !== undefined && o.version !== "" ? Number(o.version) : undefined), "Product saved.");
}
export async function saveChemistAction(fd: FormData) {
  const o = formObject(fd);
  return distRun((c) => M.saveChemist(c, id(fd), o as never, o.version !== undefined && o.version !== "" ? Number(o.version) : undefined), "Chemist saved.");
}
export async function verifyKycAction(customerId: string) { return distRun((c) => M.verifyChemistKyc(c, customerId), "Licence marked verified."); }
export async function chemistStatusAction(customerId: string, status: "active" | "hold" | "blocked", note: string) { return distRun((c) => M.setChemistStatus(c, customerId, status, note), "Status changed."); }
export async function saveTerritoryAction(fd: FormData) { return distRun((c) => M.saveTerritory(c, id(fd), formObject(fd) as never), "Territory saved."); }
export async function saveSalesmanAction(fd: FormData) { return distRun((c) => M.saveSalesman(c, id(fd), { ...formObject(fd, ["territoryIds"]), active: !bool(fd, "inactive") } as never), "Salesman saved."); }
export async function saveGodownAction(fd: FormData) { return distRun((c) => M.saveGodown(c, id(fd), formObject(fd) as never), "Godown saved."); }
export async function saveRackAction(fd: FormData) { return distRun((c) => M.saveRack(c, { ...formObject(fd), coldChain: bool(fd, "coldChain") } as never), "Rack saved."); }
export async function placeOnRackAction(fd: FormData) { return distRun((c) => M.placeOnRack(c, String(fd.get("branchId")), String(fd.get("medicineId")), String(fd.get("rack"))), "Product placed."); }
export async function saveSchemeAction(fd: FormData) { return distRun((c) => M.saveScheme(c, id(fd), { ...formObject(fd, ["customerIds"]), portal: bool(fd, "portal") } as never), "Scheme saved."); }
export async function endSchemeAction(schemeId: string) { return distRun((c) => M.endScheme(c, schemeId), "Scheme ended."); }
export async function specialRateAction(fd: FormData) { return distRun((c) => M.setSpecialRate(c, String(fd.get("customerId")), String(fd.get("medicineId")), String(fd.get("rate")), String(fd.get("validTo") ?? "")), "Special rate saved."); }
export async function saveSupplierAction(fd: FormData) { return distRun(async (c) => { distAuthorize(c, "purchase"); return saveSupplier(c, id(fd), { ...formObject(fd), acceptsReturns: bool(fd, "acceptsReturns") } as never); }, "Supplier saved."); }

// ───────────── Orders, billing, returns ─────────────
export async function quoteAction(customerId: string, lines: { medicineId: string; qty: number }[]) {
  return distRun((c) => O.quote(db, c.tenantId, c.branchId, customerId, lines));
}
export async function searchProductsAction(q: string) { return distRun((c) => M.listProducts(c, { q, take: 25 })); }
export async function placeOrderAction(input: O.OrderInput) { return distRun((c) => O.placeOrder({ kind: "user", ctx: c }, input), (r) => `Order ${r.no} placed${"creditOk" in r && r.creditOk === false ? " — on credit hold" : ""}.`); }
export async function approveOrderAction(orderId: string, overrideReason: string, allowPartial: boolean) { return distRun((c) => O.approveOrder(c, orderId, { overrideReason, allowPartial }), (r) => `Approved. Pick list ${r.pickNo}${r.cut.length ? " (cut: " + r.cut.join(", ") + ")" : ""}.`); }
export async function rejectOrderAction(orderId: string, reason: string) { return distRun((c) => O.rejectOrder(c, orderId, reason), "Order rejected."); }
export async function cancelOrderAction(orderId: string, reason: string) { return distRun((c) => O.cancelOrder({ kind: "user", ctx: c }, orderId, reason), "Order cancelled."); }
export async function startPickAction(pickId: string) { return distRun((c) => O.startPicking(c, pickId)); }
export async function confirmPickAction(lineId: string, units: number) { return distRun((c) => O.confirmPickLine(c, lineId, units)); }
export async function packAction(pickId: string, boxes: number) { return distRun((c) => O.packOrder(c, pickId, boxes), "Packed. Ready to invoice."); }
export async function invoiceOrderAction(orderId: string) { return distRun((c) => B.invoiceOrder(c, orderId), (r) => `Invoice ${r.no} raised.`); }
export async function directInvoiceAction(input: B.DirectInput) { return distRun((c) => B.directInvoice(c, input), (r) => `Invoice ${r.no} raised.`); }
export async function cancelInvoiceAction(invoiceId: string, reason: string) { return distRun((c) => B.cancelInvoice(c, invoiceId, reason), "Invoice cancelled; stock restored."); }
export async function returnAction(input: R.ReturnInput) { return distRun((c) => R.createReturn(c, input), (r) => `Credit note ${r.no} issued.`); }

// ───────────── Expiry and claims ─────────────
export async function raiseClaimAction(fd: FormData) { return distRun((c) => R.raiseDistClaim(c, formObject(fd) as never), (r) => `Claim ${r.no} raised.`); }
export async function ackClaimAction(claimId: string) { return distRun((c) => acknowledgeClaim(c, claimId), "Claim acknowledged."); }
export async function creditClaimAction(fd: FormData) { return distRun((c) => creditClaim(c, String(fd.get("id")), { ref: String(fd.get("ref") ?? ""), amount: String(fd.get("amount") ?? "0"), close: bool(fd, "close"), reason: String(fd.get("reason") ?? "") }), "Claim updated."); }

// ───────────── Stock ─────────────
export async function transferAction(fd: FormData) { return distRun(async (c) => { distAuthorize(c, "adjust"); return requestTransfer(c, String(fd.get("batchId")), String(fd.get("toBranch")), Number(fd.get("qty")), String(fd.get("note") ?? "")); }, "Transfer requested."); }
export async function transferStepAction(transferId: string, step: "approve" | "receive" | "reject" | "cancel") {
  return distRun(async (c) => { distAuthorize(c, "adjust"); return step === "approve" ? approveTransfer(c, transferId) : step === "receive" ? receiveTransfer(c, transferId) : step === "reject" ? rejectTransfer(c, transferId) : cancelTransfer(c, transferId); }, "Transfer updated.");
}
export async function adjustAction(fd: FormData) { return distRun(async (c) => { distAuthorize(c, "adjust"); return adjustStock(c, String(fd.get("batchId")), Number(fd.get("delta")), String(fd.get("reason") ?? "")); }, "Stock adjusted."); }

// ───────────── Purchases ─────────────
export async function createPoAction(input: PoInput) { return distRun(async (c) => { distAuthorize(c, "purchase"); return createPo(c, input); }, (r) => `Draft ${r.no} saved.`); }
export async function poStatusAction(poId: string, action: "place" | "cancel" | "close", reason: string) { return distRun(async (c) => { distAuthorize(c, "purchase"); return setPoStatus(c, poId, action, reason); }, "Purchase order updated."); }
export async function grnAction(input: GrnInput) { return distRun(async (c) => { distAuthorize(c, "purchase"); return approveSupplierInvoice(c, input); }, (r) => `GRN ${r.grnNo} posted; stock and supplier ledger updated.`); }

// ───────────── Dispatch, delivery, collections ─────────────
export async function createDispatchAction(fd: FormData) { return distRun((c) => D.createDispatch(c, formObject(fd, ["invoiceIds"]) as never), (r) => `Dispatch ${r.no} planned.`); }
export async function startDispatchAction(dispatchId: string) { return distRun((c) => D.startDispatch(c, dispatchId), "Dispatch is out."); }
export async function deliverAction(fd: FormData) { return distRun((c) => D.recordDelivery(c, String(fd.get("deliveryId")), formObject(fd) as never), (r) => (r.receiptNo ? `Delivered; receipt ${r.receiptNo}.` : "Saved.")); }
export async function collectAction(fd: FormData) { return distRun((c) => D.collectPayment(c, formObject(fd) as never), (no) => `Receipt ${no} posted.`); }
export async function chequeAction(chequeId: string, step: "deposit" | "clear" | "bounce", reason: string) {
  return distRun(async (c) => { distAuthorize(c, "payments"); return step === "deposit" ? depositCheque(c, chequeId) : step === "clear" ? clearCheque(c, chequeId) : bounceCheque(c, chequeId, { reason }); }, "Cheque updated.");
}

// ───────────── Accounts / bank ─────────────
export async function bankImportAction(fd: FormData) {
  return distRun(async (c) => {
    distAuthorize(c, "payments");
    const f = fd.get("file");
    if (!(f instanceof File) || !f.size) throw new UserError("Choose the bank statement file.");
    if (f.size > 5_000_000) throw new UserError("Statement file is too large (5 MB max).");
    return importBankStatement(c, f.name, new Uint8Array(await f.arrayBuffer()));
  }, "Statement imported and auto-matched.");
}
export async function bankMatchAction(lineId: string, ledgerLineId: string) { return distRun(async (c) => { distAuthorize(c, "payments"); return matchBankLine(c, lineId, ledgerLineId); }, "Matched."); }
export async function bankUnmatchAction(lineId: string) { return distRun(async (c) => { distAuthorize(c, "payments"); return unmatchBankLine(c, lineId); }, "Unmatched."); }

// ───────────── Intelligence ─────────────
export async function draftPoAction(medicineIds: string[]) { return distRun((c) => I.draftPurchaseOrders(c, medicineIds), (r) => `Draft PO ${r.join(", ")} created. Review and place under Purchases.`); }
export async function askAction(q: string) { return distRun((c) => I.askAssistant(c, q.slice(0, 300))); }

// ───────────── Portal administration ─────────────
export async function approveConnAction(fd: FormData) { return distRun((c) => P.approveConnection(c, String(fd.get("id")), formObject(fd) as never), "Chemist approved for portal ordering."); }
export async function decideConnAction(connId: string, status: "rejected" | "suspended", note: string) { return distRun((c) => P.decideConnection(c, connId, status, note), "Saved."); }
export async function portalSettingsAction(fd: FormData) {
  return distRun((c) => P.savePortalSettings(c, { enabled: bool(fd, "enabled"), discoverable: bool(fd, "discoverable"), stock: String(fd.get("stock")) as "band", showSchemes: bool(fd, "showSchemes"), showMrp: bool(fd, "showMrp"), minOrderPaise: Math.round(Number(fd.get("minOrder") || 0) * 100), serviceArea: String(fd.get("serviceArea") ?? "") }), "Portal settings saved.");
}

// ───────────── Users, settings ─────────────
export async function inviteAction(fd: FormData) { return distRun((c) => U.inviteDistUser(c, formObject(fd) as never), (r) => `Invite code ${r.code} (valid 48 hours).`); }
export async function memberAction(userId: string, patch: { role?: string; active?: boolean }) { return distRun((c) => U.updateDistMember(c, userId, patch), "User updated."); }
export async function rolePermAction(roleId: string, perm: string) { return distRun((c) => U.toggleDistPermission(c, roleId, perm), "Role updated."); }
export async function distSettingsAction(fd: FormData) { return distRun((c) => U.saveDistSettings(c, formObject(fd) as never), "Settings saved."); }
