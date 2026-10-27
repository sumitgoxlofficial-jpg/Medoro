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
export const staffSignIn = async (email: string, password: string) => open(() => people.signIn(email, password));
export const staffEnroll = async () => open(() => people.enrollTotp());
export const staffVerify = async (code: string) => open(() => people.verifyTotp(code));
export const staffSignup = async (input: Parameters<typeof people.signup>[0]) => open(() => people.signup(input));
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
  done(await staffRun((s) => support.requestRemote(s, customerId, ticketId), "Request recorded. Ask the owner to open Privacy & data → Medoro support access in their app and send you the link. It is read-only and time-limited."));
export const createTicket = async (input: Parameters<typeof support.createTicket>[1]) => done(await staffRun((s) => support.createTicket(s, input)));
export const replyTicket = async (id: string, text: string, internal: boolean, resolve: boolean) =>
  done(await staffRun((s) => support.replyTicket(s, id, text, internal, resolve), resolve ? "Ticket resolved." : internal ? "Internal note saved. The customer can’t see it." : "Reply saved on the ticket."));
export const updateTicket = async (id: string, patch: { status?: string; priority?: string; assigneeId?: string | null }) => done(await staffRun((s) => support.updateTicket(s, id, patch)));
export const escalateTicket = async (id: string) => done(await staffRun((s) => support.escalateTicket(s, id)));
