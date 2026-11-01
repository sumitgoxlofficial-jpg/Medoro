"use server";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ZodError } from "zod";
import { UserError, type ActionResult } from "@/server/action";
import { destroyStaffSession, getStaff, staffAudit, staffRun } from "@/staff/auth";
import * as people from "@/staff/people";
import * as sales from "@/staff/sales";
import * as support from "@/staff/support";
import * as licence from "@/staff/licence";
import * as coupons from "@/staff/coupons";
import * as partners from "@/staff/partners";

async function origin() {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, "");
  const h = await headers();
  return `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host") ?? "localhost:3000"}`;
}

/** For the sign-in screens, where there's no staff session yet. */
async function open<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try { return { ok: true, data: await fn() }; } catch (e) {
    if (e instanceof ZodError) return { ok: false, error: e.issues[0]?.message ?? "Invalid input." };
    if (e instanceof UserError) return { ok: false, error: e.message };
    console.error(e);
    return { ok: false, error: "Something went wrong. Try again." };
  }
}
const done = <T,>(r: ActionResult<T>) => { if (r.ok) revalidatePath("/staff", "layout"); return r; };

// ── Sign-in
export const staffSignIn = async (email: string, password: string, as: people.StaffKind = "team") => open(() => people.signIn(email, password, as));
export const staffEnroll = async () => open(() => people.enrollTotp());
export const staffVerify = async (code: string) => open(() => people.verifyTotp(code));
export const staffSignup = async (input: Parameters<typeof people.signup>[0]) => open(() => people.signup(input));
export const staffSendPartnerCode = async (email: string) => open(async () => { const { sendSignupCode } = await import("@/domain/identity/signup-email"); await sendSignupCode(email, "partner"); return null; });
export const staffVerifyPartnerCode = async (email: string, code: string) => open(async () => { const { verifySignupCode } = await import("@/domain/identity/signup-email"); await verifySignupCode(email, code); return null; });
export const staffGooglePartner = async (input: Parameters<typeof people.completeGooglePartner>[0]) => open(() => people.completeGooglePartner(input));
export const staffAcceptInvite = async (token: string, password: string) => open(() => people.acceptInvite(token, password));
export async function staffSignOut() {
  const s = await getStaff();
  if (s) await staffAudit(s, "Signed out");
  await destroyStaffSession();
  redirect("/staff/login");
}

// ── Employees and commission (super admin)
export const createEmployee = async (input: Parameters<typeof people.createEmployee>[1]) => done(await staffRun(async (s) => people.createEmployee(s, input, await origin())));
export const setEmployeeStatus = async (id: string, action: "approve" | "deactivate" | "reactivate") => done(await staffRun((s) => people.setEmployeeStatus(s, id, action)));
export const resetEmployeeSignIn = async (id: string) => done(await staffRun(async (s) => people.resetSignIn(s, id, await origin())));
export const saveRates = async (rates: Record<string, { first: string; renew: string }>, bonuses: Record<string, string>, target: string) =>
  done(await staffRun((s) => sales.saveRates(s, rates, bonuses, target), "Commission rates saved. They apply to sales logged from now on."));

// ── Pipeline and sales
export const createLead = async (input: Parameters<typeof sales.createLead>[1]) => done(await staffRun((s) => sales.createLead(s, input), "Lead saved. Follow-up set for tomorrow."));
export const moveLead = async (id: string, dir: "back" | "forward") => done(await staffRun((s) => sales.moveLead(s, id, dir)));
export const loseLead = async (id: string, reason: string) => done(await staffRun((s) => sales.loseLead(s, id, reason), "Marked lost. The reason is kept for the win/loss report."));
export const logLeadCall = async (id: string, note: string) => done(await staffRun((s) => sales.logLeadCall(s, id, note), "Call logged. Next follow-up in 2 days."));
export const requestDiscount = async (id: string, pct: number) => done(await staffRun((s) => sales.requestDiscount(s, id, pct), "Discount request sent to the super admin."));
export const decideDiscount = async (id: string, approve: boolean) => done(await staffRun((s) => sales.decideDiscount(s, id, approve), approve ? "Discount approved." : "Discount rejected."));
export const previewCommission = async (product: string, cycle: string) => staffRun((s) => sales.previewCommission(s, product, cycle));
export const logSale = async (input: Parameters<typeof sales.logSale>[1]) => done(await staffRun((s) => sales.logSale(s, input), "Sale submitted. Commission confirms when the payment is verified."));
export const verifySale = async (id: string, decision: "verify" | "reject") => done(await staffRun((s) => sales.verifySale(s, id, decision), decision === "verify" ? "Payment verified. Commission added to the next payout." : "Sale rejected."));
export const saveBank = async (input: Parameters<typeof sales.saveBank>[1]) => done(await staffRun((s) => sales.saveBank(s, input), "Bank account saved. Finance verifies it before the first payout."));
export const verifyBank = async (staffId: string) => done(await staffRun((s) => sales.verifyBank(s, staffId), "Bank account marked verified."));
export const runPayout = async () => done(await staffRun((s) => sales.runPayout(s)));

// ── Customers and support
export const addTrialCustomer = async (input: Parameters<typeof support.addTrialCustomer>[1]) => done(await staffRun((s) => support.addTrialCustomer(s, input), "Trial customer added."));
export const setCustomerStatus = async (id: string, status: string) => done(await staffRun((s) => support.setCustomerStatus(s, id, status), "Status updated."));
export const addNote = async (customerId: string, text: string, call = false) => done(await staffRun((s) => support.addNote(s, customerId, text, call), call ? "Call logged." : "Note added."));
export const requestRemote = async (customerId: string, ticketId?: string) =>
  done(await staffRun((s) => support.requestRemote(s, customerId, ticketId), "Request sent. The owner sees it in Privacy & data after their app’s next check-in (hourly, or when they open Help or Privacy). If they approve, the read-only link appears here."));
export const createTicket = async (input: Parameters<typeof support.createTicket>[1]) => done(await staffRun((s) => support.createTicket(s, input)));
export const replyTicket = async (id: string, text: string, internal: boolean, resolve: boolean) =>
  done(await staffRun((s) => support.replyTicket(s, id, text, internal, resolve), resolve ? "Ticket resolved." : internal ? "Internal note saved. The customer can’t see it." : "Reply saved on the ticket."));
export const updateTicket = async (id: string, patch: { status?: string; priority?: string; assigneeId?: string | null }) => done(await staffRun((s) => support.updateTicket(s, id, patch)));
export const escalateTicket = async (id: string) => done(await staffRun((s) => support.escalateTicket(s, id)));

// ── Licence and billing
export const issueLicenceKey = async (customerId: string) => done(await staffRun((s) => licence.issueLicenceKey(s, customerId)));
export const extendTrial = async (customerId: string, days: number) => done(await staffRun((s) => licence.extendTrial(s, customerId, days)));
export const decideBillingRequest = async (id: string, approve: boolean) =>
  done(await staffRun((s) => licence.decideBillingRequest(s, id, approve), approve ? "Approved. The pharmacy gets it with its next licence check-in." : "Request declined."));

// ── Coupons (super admin)
export const createCoupon = async (input: Parameters<typeof coupons.createCoupon>[1]) => done(await staffRun((s) => coupons.createCoupon(s, input), "Coupon created. Pharmacies can enter it on their Subscription page."));
export const setCouponActive = async (id: string, active: boolean) => done(await staffRun((s) => coupons.setCouponActive(s, id, active), active ? "Coupon switched on." : "Coupon switched off. It can’t be used any more."));

// ── Reference partners (super admin)
export const payPartnerRazorpay = async (staffId: string) => done(await staffRun((s) => partners.payWithRazorpay(s, staffId)));
export const recordPartnerTransfer = async (staffId: string, utr: string) => done(await staffRun((s) => partners.recordBankTransfer(s, staffId, utr)));
export const partnerBankDetails = async (staffId: string) => staffRun((s) => partners.payoutBankDetails(s, staffId));
export const refreshPartnerPayout = async (id: string) => done(await staffRun((s) => partners.refreshPayout(s, id)));
