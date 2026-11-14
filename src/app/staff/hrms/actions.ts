"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ZodError } from "zod";
import { UserError, type ActionResult } from "@/server/action";
import { log } from "@/server/log";
import { destroyStaffSession } from "@/staff/auth";
import * as auth from "@/staff/hrms/auth";
import * as people from "@/staff/hrms/people";
import * as time from "@/staff/hrms/time";
import * as pay from "@/staff/hrms/pay";
import * as work from "@/staff/hrms/work";
import * as leads from "@/staff/hrms/leads";
import * as fin from "@/staff/hrms/finance";
import * as ally from "@/staff/hrms/ally";
import * as gcal from "@/staff/hrms/gcal";
import * as chatBackup from "@/staff/hrms/chat-backup";
import * as assets from "@/staff/hrms/assets";
import * as monitor from "@/staff/hrms/monitor";
import * as chat from "@/staff/hrms/chat";
import * as letters from "@/staff/hrms/letters-server";
import * as leadSheet from "@/staff/hrms/lead-sheet";
import * as docs from "@/staff/hrms/docs";
import * as kyc from "@/staff/hrms/kyc";
import { digilockerConfigured } from "@/staff/hrms/digilocker";
import type { Settings } from "@/staff/hrms/constants";

const { hrRun } = auth;
/** For the sign-in screen, where there is no session yet. */
async function open<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try { return { ok: true, data: await fn() }; } catch (e) {
    if (e instanceof ZodError) return { ok: false, error: e.issues[0]?.message ?? "Invalid input." };
    if (e instanceof UserError) return { ok: false, error: e.message };
    log.error("hrms sign-in action failed", { err: e });
    return { ok: false, error: "Something went wrong. Try again." };
  }
}
const done = <T,>(r: ActionResult<T>) => { if (r.ok) revalidatePath("/staff/hrms", "layout"); return r; };
type In<F> = F extends (me: auth.Me, raw: infer A, ...rest: never[]) => unknown ? A : never;

// ── Sign-in and account
export const hrSignIn = async (id: string, password: string, code = "") => open(() => auth.signIn(id, password, code));
export const hrSendCode = async (id: string) => open(() => auth.sendCode(id));
export const hrChangePassword = async (next: string, current = "") => done(await hrRun((me) => auth.changePassword(me, next, current), "Password changed."));
export async function hrSignOut() {
  const me = await auth.getMe();
  if (me) { await people.signedOut(me); await auth.audit(me, "Signed out"); }
  await destroyStaffSession();
  redirect("/staff/login");
}

// ── Me
export const saveProfile = async (input: In<typeof people.saveProfile>, complete = false) => done(await hrRun((me) => people.saveProfile(me, input, complete), "Profile saved."));
export const savePhoto = async (dataUrl: string | null) => done(await hrRun((me) => people.savePhoto(me, dataUrl), dataUrl ? "Photo updated." : "Photo removed."));
export const acceptDocuments = async () => done(await hrRun((me) => people.acceptDocuments(me), "Documents accepted. Welcome to Medoro."));
export const startBreak = async (kind: string) => done(await hrRun((me) => people.startBreak(me, kind)));
export const endBreak = async () => done(await hrRun((me) => people.endBreak(me), "Welcome back."));
export const readNotifications = async () => done(await hrRun((me) => people.readNotifications(me)));
export const askAlly = async (q: string, history: { who: "me" | "ai"; text: string }[]) => hrRun((me) => ally.ask(me, q, history));

// ── Attendance, leave, claims
export const checkIn = async (selfie?: string) => done(await hrRun((me) => time.checkIn(me, selfie)));
export const checkOut = async (selfie?: string) => done(await hrRun((me) => time.checkOut(me, selfie), "Checked out. See you tomorrow."));
/** Idle-time monitoring (only does anything when the super admin switched it on). */
export const idleStart = async (sinceIso: string) => hrRun((me) => monitor.idleStart(me, sinceIso));
export const idleEnd = async () => hrRun((me) => monitor.idleEnd(me));
export const requestCorrection = async (input: In<typeof time.requestCorrection>) => done(await hrRun((me) => time.requestCorrection(me, input), "Correction request sent to HR."));
export const decideCorrection = async (id: string, approve: boolean) => done(await hrRun((me) => time.decideCorrection(me, id, approve), approve ? "Correction approved." : "Correction rejected."));
export const applyLeave = async (input: In<typeof time.applyLeave>) => done(await hrRun((me) => time.applyLeave(me, input)));
export const cancelLeave = async (id: string) => done(await hrRun((me) => time.cancelLeave(me, id), "Leave cancelled."));
export const decideLeave = async (id: string, approve: boolean) => done(await hrRun((me) => time.decideLeave(me, id, approve), approve ? "Leave approved." : "Leave rejected."));
export const grantLeave = async (staffId: string, type: string, days: number) => done(await hrRun((me) => time.grantLeave(me, staffId, type, days), "Leave balance updated."));
export const addHoliday = async (input: In<typeof time.addHoliday>) => done(await hrRun((me) => time.addHoliday(me, input), "Holiday added."));
export const removeHoliday = async (id: string) => done(await hrRun((me) => time.removeHoliday(me, id), "Holiday removed."));
export const addNationalHolidays = async (year: number) => done(await hrRun((me) => time.addNationalHolidays(me, year)));
export const uploadDoc = async (form: FormData) => done(await hrRun((me) => docs.uploadDoc(me, form), "Document uploaded. HR will verify it."));
export const removeDoc = async (id: string) => done(await hrRun((me) => docs.removeDoc(me, id), "Document removed."));
export const verifyDoc = async (id: string, ok: boolean) => done(await hrRun((me) => docs.verifyDoc(me, id, ok), ok ? "Marked as verified." : "Verification removed."));
export const employeeDocs = async (staffId: string) => hrRun((me) => docs.employeeDocs(me, staffId));
export const saveKyc = async (input: Parameters<typeof kyc.saveKycNumbers>[1]) => done(await hrRun((me) => kyc.saveKycNumbers(me, input), "Saved."));
export const kycStatus = async () => hrRun(async (me) => ({ ...(await kyc.kycState(me.id)), digilocker: digilockerConfigured() }));
export const revealKyc = async (staffId: string) => hrRun((me) => kyc.revealKyc(me, staffId));
export const employeeKyc = async (staffId: string) => hrRun((me) => kyc.kycStateFor(me, staffId));
export const submitClaim = async (form: FormData) => done(await hrRun((me) => time.submitClaim(me, form), "Claim submitted. HR reviews it first."));
export const hrDecideClaim = async (id: string, approve: boolean) => done(await hrRun((me) => time.hrDecideClaim(me, id, approve), approve ? "Sent to the super admin for final sign-off." : "Claim rejected."));
export const adminDecideClaim = async (id: string, approve: boolean) => done(await hrRun((me) => time.adminDecideClaim(me, id, approve), approve ? "Approved. It is paid with the next payroll." : "Claim rejected."));

// ── Employees
export const createEmployee = async (input: In<typeof people.createEmployee>) => done(await hrRun((me) => people.createEmployee(me, input)));
export const previewOfficialEmail = async (name: string) => hrRun(async (me) => { auth.need(me, "employees"); return people.officialEmail(name); });
export const updateEmployee = async (id: string, input: Parameters<typeof people.updateEmployee>[2]) => done(await hrRun((me) => people.updateEmployee(me, id, input), "Employee updated."));
export const setEmployeeActive = async (id: string, active: boolean, lastDay?: string) => done(await hrRun((me) => people.setEmployeeActive(me, id, active, lastDay), active ? "Done. The employee is active." : lastDay && lastDay > new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10) ? "Last working day recorded. They are deactivated the day after it." : "Employee deactivated and signed out everywhere."));
export const issueOneTimePassword = async (id: string) => done(await hrRun((me) => people.issueOneTimePassword(me, id)));
export const tickOnboarding = async (id: string, step: number, on: boolean) => done(await hrRun((me) => people.tickOnboarding(me, id, step, on)));
export const saveDepartment = async (input: In<typeof people.saveDepartment>) => done(await hrRun((me) => people.saveDepartment(me, input), "Department saved."));
export const deleteDepartment = async (id: string) => done(await hrRun((me) => people.deleteDepartment(me, id), "Department deleted."));

// ── Payroll
export const processPayroll = async (month: string, lop: Record<string, number>) => done(await hrRun((me) => pay.processPayroll(me, month, lop)));
export const bankFile = async (month: string) => hrRun((me) => pay.bankFile(me, month));
export const confirmBank = async (staffId: string) => done(await hrRun((me) => people.confirmBank(me, staffId), "Bank account confirmed."));
export const payrollReport = async (month: string) => hrRun((me) => pay.payrollReport(me, month));
export const pfReturn = async (month: string) => hrRun((me) => pay.pfReturn(me, month));
export const esiReturn = async (month: string) => hrRun((me) => pay.esiReturn(me, month));
export const taxStatement = async (fyStart: number, staffId?: string) => hrRun((me) => pay.taxStatement(me, staffId || me.id, fyStart));
export const openPayslip = async (id: string) => hrRun((me) => pay.payslip(me, id));

// ── Tasks, projects, meetings, announcements
export const assignTask = async (input: In<typeof work.assignTask>) => done(await hrRun((me) => work.assignTask(me, input), "Task assigned."));
export const addReminder = async (input: In<typeof work.addReminder>) => done(await hrRun((me) => work.addReminder(me, input), "Reminder added."));
export const setTaskDone = async (id: string, on: boolean, comment = "") => done(await hrRun((me) => work.setTaskDone(me, id, on, comment)));
export const moveTask = async (id: string, col: string) => done(await hrRun((me) => work.moveTask(me, id, col)));
export const deleteTask = async (id: string) => done(await hrRun((me) => work.deleteTask(me, id), "Removed."));
export const saveProject = async (input: In<typeof work.saveProject>) => done(await hrRun((me) => work.saveProject(me, input), "Project saved."));
export const saveRisk = async (input: In<typeof work.saveRisk>) => done(await hrRun((me) => work.saveRisk(me, input), "Risk saved."));
export const deleteRisk = async (id: string) => done(await hrRun((me) => work.deleteRisk(me, id), "Risk removed."));
export const saveSprint = async (input: In<typeof work.saveSprint>) => done(await hrRun((me) => work.saveSprint(me, input), "Sprint saved."));
export const deleteSprint = async (id: string) => done(await hrRun((me) => work.deleteSprint(me, id), "Sprint deleted."));
export const setTaskSprint = async (taskId: string, sprintId: string | null) => done(await hrRun((me) => work.setTaskSprint(me, taskId, sprintId)));
export const deleteProject = async (id: string) => done(await hrRun((me) => work.deleteProject(me, id), "Project deleted."));
export const postAnnouncement = async (input: In<typeof work.postAnnouncement>) => done(await hrRun((me) => work.postAnnouncement(me, input), "Announcement posted to everyone."));
export const deleteAnnouncement = async (id: string) => done(await hrRun((me) => work.deleteAnnouncement(me, id), "Announcement removed."));
export const scheduleMeeting = async (input: In<typeof work.scheduleMeeting>) => done(await hrRun((me) => work.scheduleMeeting(me, input)));
export const chatBackupNow = async () => done(await hrRun(async (me) => { const r = await chatBackup.backUp(me.id, me); return r; }, "Chats backed up to your Google Drive."));
export const chatBackupRestore = async () => done(await hrRun((me) => chatBackup.restore(me)));
export const chatBackupDisconnect = async () => done(await hrRun((me) => chatBackup.disconnect(me), "Chat backup disconnected."));
export const disconnectGoogle = async () => done(await hrRun((me) => gcal.disconnect(me), "Google Calendar disconnected."));
export const saveMeetingNotes = async (id: string, notes: string) => done(await hrRun((me) => work.saveMeetingNotes(me, id, notes), "Minutes saved."));
export const cancelMeeting = async (id: string) => done(await hrRun((me) => work.cancelMeeting(me, id), "Meeting cancelled."));
export const recognise = async (input: In<typeof work.recognise>) => done(await hrRun((me) => work.recognise(me, input), "Recognition sent."));
export const raiseTicket = async (input: In<typeof work.raiseTicket>) => done(await hrRun((me) => work.raiseTicket(me, input)));
export const resolveTicket = async (id: string, reply: string) => done(await hrRun((me) => work.resolveTicket(me, id, reply), "Ticket resolved."));

// ── Recruitment
export const postJob = async (input: In<typeof work.postJob>) => done(await hrRun((me) => work.postJob(me, input), "Job posted. Employees can refer candidates."));
export const setJobOpen = async (id: string, on: boolean) => done(await hrRun((me) => work.setJobOpen(me, id, on), on ? "Job reopened." : "Job closed."));
export const addCandidate = async (input: In<typeof work.addCandidate>) => done(await hrRun((me) => work.addCandidate(me, input), "Candidate added."));
export const referCandidate = async (input: In<typeof work.addCandidate>) => done(await hrRun((me) => work.addCandidate(me, input, true), "Referral sent to HR. Thank you."));
export const moveCandidate = async (id: string, stage: string) => done(await hrRun((me) => work.moveCandidate(me, id, stage)));
export const scoreCandidate = async (id: string, score: number) => done(await hrRun((me) => work.scoreCandidate(me, id, score)));
export const saveOffer = async (id: string, input: Parameters<typeof work.saveOffer>[2]) => done(await hrRun((me) => work.saveOffer(me, id, input), "Offer letter saved."));

// ── Leads
export const setLeadStage = async (id: string, stage: string, lostReason = "") => done(await hrRun((me) => leads.setStage(me, id, stage, lostReason)));
export const setLeadFollowUp = async (id: string, day: string) => done(await hrRun((me) => leads.setFollowUp(me, id, day), "Follow-up date saved."));
export const logLeadCall = async (id: string, note: string) => done(await hrRun((me) => leads.logCall(me, id, note), "Call logged. Next follow-up in 2 days."));
export const addLead = async (input: In<typeof leads.addLead>) => done(await hrRun((me) => leads.addLead(me, input)));
export const importLeads = async (text: string) => done(await hrRun((me) => leads.importLeads(me, text)));
export const assignLead = async (id: string, staffId: string) => done(await hrRun((me) => leads.assignLead(me, id, staffId)));
export const autoAssignLeads = async () => done(await hrRun((me) => leads.autoAssign(me)));
export const setSalesTerms = async (staffId: string, input: Parameters<typeof leads.setSalesTerms>[2]) => done(await hrRun((me) => leads.setSalesTerms(me, staffId, input), "Target and incentive saved."));

// ── Accounts
export const addRecord = async (kind: string, values: string[]) => done(await hrRun((me) => fin.addRecord(me, kind, values), "Saved."));
export const setRecordStatus = async (id: string, status: string) => done(await hrRun((me) => fin.setRecordStatus(me, id, status)));
export const deleteRecord = async (id: string) => done(await hrRun((me) => fin.deleteRecord(me, id), "Deleted."));
export const createInvoice = async (input: In<typeof fin.createInvoice>) => done(await hrRun((me) => fin.createInvoice(me, input)));
export const openInvoice = async (id: string) => hrRun((me) => fin.invoice(me, id));

// ── Super admin
export const saveSettings = async (input: Settings) => done(await hrRun((me) => people.saveSettings(me, input), "Settings saved."));
export const togglePerm = async (role: string, moduleId: string) => done(await hrRun((me) => people.togglePerm(me, role, moduleId)));

// ── Assets and workflows
export const addAsset = async (input: In<typeof assets.addAsset>) => done(await hrRun((me) => assets.addAsset(me, input), "Asset added."));
export const issueAsset = async (id: string, staffId: string) => done(await hrRun((me) => assets.issueAsset(me, id, staffId), "Issued."));
export const returnAsset = async (id: string, status: "in_stock" | "repair" | "lost" = "in_stock") => done(await hrRun((me) => assets.returnAsset(me, id, status), "Taken back."));
export const setAssetStatus = async (id: string, status: string) => done(await hrRun((me) => assets.setAssetStatus(me, id, status)));
export const reportAssetIssue = async (id: string, note: string) => done(await hrRun((me) => assets.reportIssue(me, id, note)));
export const setWorkflow = async (id: string, on: boolean) => done(await hrRun((me) => fin.setWorkflow(me, id, on)));

// ── Team Chat (no revalidate: the chat screen keeps its own live state)
export const chatOpenDm = async (otherId: string) => hrRun((me) => chat.openDm(me, otherId));
export const chatCreateGroup = async (name: string, members: string[]) => hrRun((me) => chat.createGroup(me, name, members), "Group created.");
export const chatSend = async (chatId: string, body: string) => hrRun((me) => chat.sendText(me, chatId, body));
export const chatSendImage = async (chatId: string, form: FormData) => hrRun((me) => chat.sendImage(me, chatId, form));
export const chatDelete = async (id: string) => hrRun((me) => chat.deleteMessage(me, id), "Message deleted.");
export const chatMeet = async (chatId: string) => hrRun((me) => chat.startMeet(me, chatId));
export const chatAddMembers = async (chatId: string, members: string[]) => hrRun((me) => chat.addToGroup(me, chatId, members), "People added.");
export const chatLeave = async (chatId: string) => hrRun((me) => chat.leaveGroup(me, chatId), "You left the group.");
export const chatReviewOpen = async (staffId: string, chatId: string) => hrRun((me) => chat.reviewMessages(me, staffId, chatId));
export const chatTyping = async (chatId: string) => hrRun((me) => chat.setTyping(me, chatId));
export const chatReact = async (messageId: string, emoji: string) => hrRun((me) => chat.react(me, messageId, emoji));
export const chatPoll = async (chatId: string, q: string, options: string[], multi: boolean) => hrRun((me) => chat.sendPoll(me, chatId, q, options, multi));
export const chatVote = async (messageId: string, option: number) => hrRun((me) => chat.vote(me, messageId, option));
export const chatGroupInfo = async (chatId: string) => hrRun((me) => chat.groupInfo(me, chatId));
export const chatUpdateGroup = async (chatId: string, input: { about?: string; photo?: string | null }) => hrRun((me) => chat.updateGroup(me, chatId, input), "Group updated.");
export const chatSetAvatar = async (emoji: string) => hrRun((me) => chat.setChatAvatar(me, emoji), "Chat avatar saved.");

// ── Letters (viewing only changes nothing, so these don't refresh the page)
export const getLetter = async (staffId: string, type: string, lastDay?: string) => hrRun((me) => letters.letterFor(me, staffId === "me" ? me.id : staffId, type, lastDay));
export const getOfferLetter = async (candidateId: string) => hrRun((me) => letters.candidateLetter(me, candidateId));
export const emailLetter = async (staffId: string, type: string, lastDay?: string) => hrRun((me) => letters.emailLetter(me, staffId, type, lastDay));
export const emailOffer = async (candidateId: string) => done(await hrRun((me) => letters.emailOffer(me, candidateId)));

// ── Master lead sheet (Google Sheets)
export const saveLeadSheet = async (input: { url: string; auto: boolean; assign: boolean }) => done(await hrRun((me) => leadSheet.saveSheet(me, input), "Lead sheet saved."));
export const syncLeadSheet = async () => done(await hrRun((me) => leadSheet.syncSheet(me)));
export const sendLetters = async (staffId: string, types: string[], lastDay: string, email: boolean) => done(await hrRun((me) => letters.sendLetters(me, staffId, types, lastDay, email)));
