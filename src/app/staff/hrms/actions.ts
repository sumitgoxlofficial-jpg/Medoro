"use server";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { clientIp } from "@/server/auth";
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
import * as offerSign from "@/staff/hrms/offer-sign";
import * as wa from "@/staff/hrms/whatsapp";
import * as promos from "@/staff/hrms/promotions";
import * as leadSheet from "@/staff/hrms/lead-sheet";
import * as docs from "@/staff/hrms/docs";
import * as kyc from "@/staff/hrms/kyc";
import * as careers from "@/staff/hrms/careers";
import * as policies from "@/staff/hrms/policies";
import * as exits from "@/staff/hrms/exits";
import * as appraisals from "@/staff/hrms/appraisals";
import * as org from "@/staff/hrms/org";
import * as approvals from "@/staff/hrms/approvals";
import * as workforce from "@/staff/hrms/workforce";
import * as kpi from "@/staff/hrms/kpi";
import * as shifts from "@/staff/hrms/shifts";
import * as learning from "@/staff/hrms/learning";
import * as surveys from "@/staff/hrms/surveys";
import * as mgmt from "@/staff/hrms/mgmt";
import * as aiHr from "@/staff/hrms/ai-hr/service";
import * as aiPush from "@/staff/hrms/ai-hr/push";
import { digilockerConfigured } from "@/staff/hrms/digilocker";
import { gateOf } from "@/staff/hrms/gate";
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
export const hrChangePassword = async (next: string, current = "") => done(await hrRun((me) => auth.changePassword(me, next, current), "Password changed.", { during: auth.ANY_STEP }));
/** Super admins and care open the staff console from the HRMS; it asks for their authenticator first. */
export async function openStaffConsole() {
  const me = await auth.getMe();
  if (!me) redirect("/staff/employee");
  return auth.consoleStepUp(me);
}
export async function hrSignOut() {
  const me = await auth.getMe();
  if (me) { await people.signedOut(me); await auth.audit(me, "Signed out"); }
  await destroyStaffSession();
  redirect("/staff/employee");
}

// ── Me
export const saveProfile = async (input: In<typeof people.saveProfile>, complete = false) => done(await hrRun((me) => people.saveProfile(me, input, complete), "Profile saved.", { during: ["profile"] }));
export const savePhoto = async (dataUrl: string | null) => done(await hrRun((me) => people.savePhoto(me, dataUrl), dataUrl ? "Photo updated." : "Photo removed."));
export const acceptDocuments = async () => done(await hrRun((me) => people.acceptDocuments(me), "Documents accepted. Welcome to Medoro.", { during: ["docs"] }));
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
export const uploadDoc = async (form: FormData) => done(await hrRun((me) => docs.uploadDoc(me, form), "Document uploaded. HR will verify it.", { during: ["kyc"] }));
export const removeDoc = async (id: string) => done(await hrRun((me) => docs.removeDoc(me, id), "Document removed."));
export const rejectDoc = async (id: string, reason: string) => done(await hrRun((me) => docs.rejectDoc(me, id, reason), "Sent back to the employee."));
export const verifyDoc = async (id: string, ok: boolean) => done(await hrRun((me) => docs.verifyDoc(me, id, ok), ok ? "Marked as verified." : "Verification removed."));
export const employeeDocs = async (staffId: string) => hrRun((me) => docs.employeeDocs(me, staffId));
export const setDocExpiry = async (id: string, expiresOn: string | null) => done(await hrRun((me) => docs.setDocExpiry(me, id, expiresOn), expiresOn ? "Expiry date saved. Reminders go out 30 and 7 days before." : "Expiry date removed."));
export const saveKyc = async (input: Parameters<typeof kyc.saveKycNumbers>[1]) => done(await hrRun((me) => kyc.saveKycNumbers(me, input), "Saved.", { during: ["kyc"] }));
export const skipKyc = async () => done(await hrRun((me) => kyc.skipKyc(me), "No problem. You can add them later from your profile.", { during: ["kyc"] }));
export const kycStatus = async () => hrRun(async (me) => ({ ...(await kyc.kycState(me.id)), digilocker: digilockerConfigured() }), undefined, { during: ["kyc"] });
export const revealKyc = async (staffId: string) => hrRun((me) => kyc.revealKyc(me, staffId));
export const employeeKyc = async (staffId: string) => hrRun((me) => kyc.kycStateFor(me, staffId));
export const submitClaim = async (form: FormData) => done(await hrRun((me) => time.submitClaim(me, form), "Claim submitted. HR reviews it first."));
export const hrDecideClaim = async (id: string, approve: boolean) => done(await hrRun((me) => time.hrDecideClaim(me, id, approve), approve ? "Sent to the super admin for final sign-off." : "Claim rejected."));
export const adminDecideClaim = async (id: string, approve: boolean) => done(await hrRun((me) => time.adminDecideClaim(me, id, approve), approve ? "Approved. It is paid with the next payroll." : "Claim rejected."));

// ── Employees
export const createEmployee = async (input: In<typeof people.createEmployee>) => done(await hrRun((me) => people.createEmployee(me, input)));
export const previewOfficialEmail = async (name: string) => hrRun(async (me) => { auth.need(me, "employees"); return people.officialEmail(name); });
export const checkOfficialUsername = async (user: string) => hrRun(async (me) => { auth.need(me, "employees"); return people.checkOfficialUsername(user); });
export const updateEmployee = async (id: string, input: Parameters<typeof people.updateEmployee>[2]) => done(await hrRun((me) => people.updateEmployee(me, id, input), "Employee updated."));
export const setEmployeeActive = async (id: string, active: boolean, lastDay?: string) => done(await hrRun((me) => people.setEmployeeActive(me, id, active, lastDay), active ? "Done. The employee is active." : lastDay && lastDay > new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10) ? "Last working day recorded. They are deactivated the day after it." : "Employee deactivated and signed out everywhere."));
export const deleteEmployee = async (id: string) => done(await hrRun((me) => people.deleteEmployee(me, id), "Account deleted. Their payroll records are kept."));
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
export const postJob = async (input: careers.JobInput) => done(await hrRun((me) => careers.postJob(me, input), "Job posted on the careers page."));
export const updateJob = async (id: string, input: careers.JobInput) => done(await hrRun((me) => careers.updateJob(me, id, input), "Job updated."));
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
export const setSalesTerms = async (staffId: string, input: Parameters<typeof leads.setSalesTerms>[2]) => done(await hrRun((me) => leads.setSalesTerms(me, staffId, input), "Target, incentive and monthly leads saved."));

// ── Accounts
export const addRecord = async (kind: string, values: string[]) => done(await hrRun((me) => fin.addRecord(me, kind, values), "Saved."));
export const setRecordStatus = async (id: string, status: string) => done(await hrRun((me) => fin.setRecordStatus(me, id, status)));
export const deleteRecord = async (id: string) => done(await hrRun((me) => fin.deleteRecord(me, id), "Deleted."));
export const createInvoice = async (input: In<typeof fin.createInvoice>) => done(await hrRun((me) => fin.createInvoice(me, input)));
export const openInvoice = async (id: string) => hrRun((me) => fin.invoice(me, id));

// ── Super admin
export const saveSettings = async (input: Settings) => done(await hrRun((me) => people.saveSettings(me, input), "Settings saved."));
export const togglePerm = async (role: string, moduleId: string) => done(await hrRun((me) => people.togglePerm(me, role, moduleId)));

// ── WhatsApp alerts
export const saveWhatsAppAlerts = async (input: In<typeof wa.saveWaConfig>) => done(await hrRun((me) => wa.saveWaConfig(me, input), "WhatsApp alert settings saved."));
export const sendWhatsAppTest = async () => done(await hrRun((me) => wa.sendWaTest(me)));
export const setMyWhatsAppAlerts = async (on: boolean) => done(await hrRun((me) => wa.setMyWaAlerts(me, on), on ? "You’ll get your HR alerts on WhatsApp too." : "WhatsApp alerts switched off."));
// ── Company policies
export const acknowledgePolicy = async (id: string) => done(await hrRun((me) => policies.acknowledgePolicy(me, id), "Thank you. Your acknowledgement is recorded."));
export const savePolicy = async (id: string | null, input: { title: string; category: string; body: string; mandatory: boolean; reack: boolean }) => done(await hrRun((me) => policies.savePolicy(me, id, input as never), id ? "Policy saved." : "Policy published. Everyone was told."));
export const archivePolicy = async (id: string, archived: boolean) => done(await hrRun((me) => policies.archivePolicy(me, id, archived), archived ? "Policy archived." : "Policy restored."));
export const remindPolicy = async (id: string) => done(await hrRun(async (me) => { const n = await policies.remindPolicy(me, id); return n; }, "Reminder sent to everyone who hasn’t acknowledged it."));
// ── Exits: resignation, exit interview, clearance
export const resign = async (input: In<typeof exits.resign>) => done(await hrRun((me) => exits.resign(me, input), "Resignation sent to HR."));
export const withdrawResignation = async () => done(await hrRun((me) => exits.withdrawResignation(me), "Resignation withdrawn."));
export const decideResignation = async (id: string, input: { accept: boolean; lastDay?: string; note?: string }) => done(await hrRun((me) => exits.decideResignation(me, id, input), input.accept ? "Resignation accepted. The exit is recorded." : "Resignation declined."));
export const saveExitInterview = async (answers: Record<string, string | number>) => done(await hrRun((me) => exits.saveInterview(me, answers), "Thank you. Your exit interview was sent to HR."));
export const tickClearance = async (staffId: string, item: string, isDone: boolean) => done(await hrRun((me) => exits.tickClearance(me, staffId, item, isDone)));
// ── Performance appraisals
export const submitSelfReview = async (id: string, input: { rating: number; achievements: string; challenges: string; goals: string }) => done(await hrRun((me) => appraisals.submitSelf(me, id, input), "Self-assessment sent."));
export const submitManagerReview = async (id: string, input: { rating: number; strengths: string; improve: string; comments: string }) => done(await hrRun((me) => appraisals.submitManager(me, id, input), "Review sent to HR."));
export const acknowledgeReview = async (id: string) => done(await hrRun((me) => appraisals.acknowledgeReview(me, id), "Thank you. Your acknowledgement is recorded."));
export const openReviewCycle = async (input: { name: string; periodFrom: string; periodTo: string; selfDue: string; managerDue: string }) => done(await hrRun((me) => appraisals.openCycle(me, input), "Review cycle opened. Everyone was told."));
export const closeReviewCycle = async (id: string) => done(await hrRun((me) => appraisals.closeCycle(me, id), "Review cycle closed."));
export const finalizeReview = async (id: string, input: { rating: number; note: string }) => done(await hrRun((me) => appraisals.finalizeReview(me, id, input), "Final rating saved. The employee was told."));

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
export const chatSendFile = async (chatId: string, form: FormData) => hrRun((me) => chat.sendFile(me, chatId, form));
export const chatEdit = async (id: string, body: string) => hrRun((me) => chat.editMessage(me, id, body));
export const chatDelete = async (id: string) => hrRun((me) => chat.deleteMessage(me, id), "Message deleted.");
export const chatMeet = async (chatId: string) => hrRun((me) => chat.startMeet(me, chatId));
export const chatAddMembers = async (chatId: string, members: string[]) => hrRun((me) => chat.addToGroup(me, chatId, members), "People added.");
export const chatLeave = async (chatId: string) => hrRun((me) => chat.leaveGroup(me, chatId), "You left the group.");
export const chatReviewOpen = async (staffId: string, chatId: string) => hrRun((me) => chat.reviewMessages(me, staffId, chatId));
export const chatTyping = async (chatId: string) => hrRun((me) => chat.setTyping(me, chatId));
export const chatReact = async (messageId: string, emoji: string) => hrRun((me) => chat.react(me, messageId, emoji));
export const chatPoll = async (chatId: string, q: string, options: string[], multi: boolean) => hrRun((me) => chat.sendPoll(me, chatId, q, options, multi));
export const chatVote = async (messageId: string, option: number) => hrRun((me) => chat.vote(me, messageId, option));
export const chatSalesBoard = async (chatId: string) => hrRun((me) => chat.salesBoard(me, chatId));
export const chatGroupInfo = async (chatId: string) => hrRun((me) => chat.groupInfo(me, chatId));
export const chatUpdateGroup = async (chatId: string, input: { name?: string; about?: string; photo?: string | null }) => hrRun((me) => chat.updateGroup(me, chatId, input), "Group updated.");
export const chatRemoveMember = async (chatId: string, staffId: string) => hrRun((me) => chat.removeFromGroup(me, chatId, staffId), "Removed from the group.");
export const chatDeleteGroup = async (chatId: string) => hrRun((me) => chat.deleteGroup(me, chatId), "Group deleted.");
export const chatSetAvatar = async (emoji: string) => hrRun((me) => chat.setChatAvatar(me, emoji), "Chat avatar saved.");

// ── Letters (viewing only changes nothing, so these don't refresh the page)
// During the joining-documents step a person may read only their own letters.
export const getLetter = async (staffId: string, type: string, lastDay?: string) => hrRun((me) => { if (gateOf(me) && staffId !== "me" && staffId !== me.id) throw new UserError(auth.GATE_MESSAGE); return letters.letterFor(me, staffId === "me" ? me.id : staffId, type, lastDay); }, undefined, { during: ["docs"] });
/** The employee e-signs their own appointment letter or NDA (also during the joining-documents step). */
export const signMyLetter = async (type: string, input: unknown) => {
  const h = await headers(), ip = clientIp(h), userAgent = h.get("user-agent") ?? "";
  return done(await hrRun((me) => letters.signJoiningLetter(me, type, input, { ip, userAgent }), "Signed. A copy has been emailed to you.", { during: ["docs"] }));
};
export const myLetterSignatures = async () => hrRun((me) => letters.letterSignatures(me.id), undefined, { during: ["docs"] });
export const staffLetterSignatures = async (staffId: string) => hrRun((me) => { auth.need(me, "employees"); return letters.letterSignatures(staffId); });
export const getOfferLetter = async (candidateId: string) => hrRun((me) => letters.candidateLetter(me, candidateId));
export const emailLetter = async (staffId: string, type: string, lastDay?: string) => hrRun((me) => letters.emailLetter(me, staffId, type, lastDay));
export const emailOffer = async (candidateId: string) => done(await hrRun((me) => letters.emailOffer(me, candidateId)));
/** Sends the offer for e-signature: the link goes by email, and comes back here too so HR can share it another way. */
export const sendOfferForSignature = async (candidateId: string) => {
  const h = await headers(), host = h.get("x-forwarded-host") ?? h.get("host"), proto = h.get("x-forwarded-proto")?.split(",")[0].trim() || "https";
  return done(await hrRun((me) => offerSign.sendForSignature(me, candidateId, host ? `${proto}://${host}` : "")));
};
export const getOfferSigning = async (candidateId: string) => hrRun((me) => offerSign.signingStatus(me, candidateId));
export const retryOfferHire = async (candidateId: string) => done(await hrRun((me) => offerSign.retryHire(me, candidateId), "Employee created."));

// ── Master lead sheet (Google Sheets)
export const saveLeadSheet = async (input: { url: string; auto: boolean; assign: boolean }) => done(await hrRun((me) => leadSheet.saveSheet(me, input), "Lead sheet saved."));
export const syncLeadSheet = async () => done(await hrRun((me) => leadSheet.syncSheet(me)));
export const sendLetters = async (staffId: string, types: string[], lastDay: string, email: boolean) => done(await hrRun((me) => letters.sendLetters(me, staffId, types, lastDay, email)));

// ── Promotions
/** Records the promotion and puts the Letter of Promotion on the employee's screen. Emailing it is a separate step (sendLetters), so a mail failure never undoes a promotion. */
export const promoteEmployee = async (staffId: string, input: Parameters<typeof promos.promote>[2]) => done(await hrRun(async (me) => {
  const r = await promos.promote(me, staffId, input);
  await letters.sendLetters(me, staffId, ["promotion"], r.effective, false);
  return r;
}));
export const cancelPromotion = async (id: string) => done(await hrRun((me) => promos.cancelPromotion(me, id), "Promotion cancelled."));

// ── Organisation (Enterprise HRMS Phase 2)
export const employeeTimeline = async (staffId: string) => hrRun((me) => org.timeline(me, staffId));

// ── Approvals, delegation, individual access, two-step sign-in (Enterprise HRMS Phase 3)
export const requestApproval = async (kind: string, input: unknown) => done(await hrRun((me) => approvals.requestApproval(me, kind, input), "Request sent for approval."));
export const decideApproval = async (id: string, approve: boolean, comment = "") => done(await hrRun((me) => approvals.decideApproval(me, id, approve, comment), approve ? "Approved." : "Rejected."));
export const cancelApproval = async (id: string) => done(await hrRun((me) => approvals.cancelApproval(me, id), "Request withdrawn."));
export const delegateApprovals = async (input: Parameters<typeof approvals.delegate>[1]) => done(await hrRun((me) => approvals.delegate(me, input), "Your approvals are delegated."));
export const cancelDelegation = async (id: string) => done(await hrRun((me) => approvals.cancelDelegation(me, id), "Delegation cancelled."));
export const addAccessGrant = async (input: unknown) => done(await hrRun((me) => approvals.addGrant(me, input), "Access changed for that person."));
export const revokeAccessGrant = async (id: string) => done(await hrRun((me) => approvals.revokeGrant(me, id), "Access change ended."));
export const mfaStart = async () => hrRun((me) => auth.mfaStart(me), undefined, { during: ["mfa"] });
export const mfaConfirm = async (code: string) => done(await hrRun((me) => auth.mfaConfirm(me, code), undefined, { during: ["mfa"] }));

// ── Workforce devices and activity (Enterprise HRMS Phase 4)
export const issueDeviceCode = async (staffId: string) => done(await hrRun((me) => workforce.issueDeviceCode(me, staffId)));
export const revokeDevice = async (id: string, reason = "") => done(await hrRun((me) => workforce.revokeDevice(me, id, reason), "PC removed. It stops at its next contact."));
export const acknowledgeMonitorPolicy = async () => done(await hrRun((me) => workforce.acknowledgePolicy(me), "Thank you. Your acceptance is recorded."));
export const raiseActivityDispute = async (input: Parameters<typeof workforce.raiseDispute>[1]) => done(await hrRun((me) => workforce.raiseDispute(me, input), "Dispute sent to HR."));
export const decideActivityDispute = async (id: string, accept: boolean, reply = "") => done(await hrRun((me) => workforce.decideDispute(me, id, accept, reply), accept ? "Accepted. Those minutes are removed." : "Rejected."));
export const activityFor = async (staffId: string, day: string) => hrRun((me) => workforce.activityDay(me, staffId, day));
export const setAppCategory = async (app: string, category: string) => done(await hrRun((me) => workforce.setAppCategory(me, app, category), "Category saved."));

// ── KPIs and suggestions (Enterprise HRMS Phase 5)
export const saveKpi = async (id: string | null, input: Parameters<typeof kpi.saveKpi>[2]) => done(await hrRun((me) => kpi.saveKpi(me, id, input), "KPI saved. Compute to update results."));
export const setKpiActive = async (id: string, active: boolean) => done(await hrRun((me) => kpi.setKpiActive(me, id, active), active ? "KPI switched on." : "KPI switched off."));
export const computeKpis = async (day: string) => done(await hrRun(async (me) => { const n = await kpi.computeKpis(me, day); await kpi.generateInsights(day); return n; }));
export const enterKpiValue = async (input: Parameters<typeof kpi.enterManual>[1]) => done(await hrRun((me) => kpi.enterManual(me, input), "Value saved."));
export const kpiFor = async (staffId: string, day: string) => hrRun((me) => kpi.kpiFor(me, staffId, day));
export const reviewInsight = async (id: string, decision: "reviewed" | "dismissed", note = "", share = false) => done(await hrRun((me) => kpi.reviewInsight(me, id, decision, note, share), decision === "reviewed" ? (share ? "Reviewed and shared." : "Marked reviewed.") : "Dismissed."));

// ── Shifts, roster, overtime, payroll readiness (Enterprise HRMS Phase 6)
export const saveShift = async (id: string | null, input: Parameters<typeof shifts.saveShift>[2]) => done(await hrRun((me) => shifts.saveShift(me, id, input), "Shift saved."));
export const archiveShift = async (id: string) => done(await hrRun((me) => shifts.archiveShift(me, id), "Shift archived."));
export const assignShift = async (input: Parameters<typeof shifts.assignShift>[1]) => done(await hrRun((me) => shifts.assignShift(me, input), "Roster saved. Each person was told."));

// ── Learning and engagement (Enterprise HRMS Phase 7)
export const saveCourse = async (id: string | null, input: Parameters<typeof learning.saveCourse>[2]) => done(await hrRun((me) => learning.saveCourse(me, id, input), "Course saved."));
export const publishCourse = async (id: string) => done(await hrRun((me) => learning.publishCourse(me, id), undefined));
export const assignCourse = async (id: string, staffIds: string[]) => done(await hrRun((me) => learning.assignCourse(me, id, staffIds)));
export const archiveCourse = async (id: string) => done(await hrRun((me) => learning.archiveCourse(me, id), "Course archived."));
export const openCourse = async (id: string) => hrRun((me) => learning.openCourse(me, id));
export const markLessonRead = async (id: string, index: number) => done(await hrRun((me) => learning.markLessonRead(me, id, index)));
export const submitQuiz = async (id: string, answers: number[]) => done(await hrRun((me) => learning.submitQuiz(me, id, answers)));
export const resetCourseAttempts = async (id: string, staffId: string) => done(await hrRun((me) => learning.resetAttempts(me, id, staffId), "Attempts reset."));
export const createSurvey = async (input: Parameters<typeof surveys.createSurvey>[1]) => done(await hrRun((me) => surveys.createSurvey(me, input), "Survey sent."));
export const closeSurvey = async (id: string) => done(await hrRun((me) => surveys.closeSurvey(me, id), "Survey closed."));
export const answerSurvey = async (id: string, answers: unknown[]) => done(await hrRun((me) => surveys.answerSurvey(me, id, answers), "Thank you. Your answer is recorded."));
export const surveyResults = async (id: string) => hrRun((me) => surveys.surveyResults(me, id));

// ── Management dashboard (Enterprise HRMS Phase 8)
export const managementCsv = async () => hrRun((me) => mgmt.managementCsv(me));

// ── AI HR Assistant
export const aiHrSaveConfig = async (input: unknown) => done(await hrRun((me) => aiHr.saveConfig(me, input), "AI HR Assistant settings saved."));
export const aiHrRequestOvertime = async (input: Parameters<typeof aiHr.requestOvertime>[1]) => done(await hrRun((me) => aiHr.requestOvertime(me, input), "Overtime request sent. The employee is asked in the HRMS; you'll see their answer here."));
export const aiHrManualCall = async (staffId: string, topic: string) => done(await hrRun((me) => aiHr.startManualCall(me, staffId, topic), "Follow-up conversation scheduled."));
export const aiHrCallDetail = async (id: string) => hrRun((me) => aiHr.callDetail(me, id));
export const aiHrDecide = async (id: string, approve: boolean, note = "", leaveType = "") => done(await hrRun((me) => aiHr.decideAction(me, id, approve, note, leaveType), approve ? "Approved. The employee was told." : "Rejected. The employee was told."));
export const aiHrDeleteTranscript = async (id: string) => done(await hrRun((me) => aiHr.deleteTranscript(me, id), "Transcript deleted."));
export const aiHrSaveKnowledge = async (input: Parameters<typeof aiHr.saveKnowledgeDraft>[1]) => done(await hrRun((me) => aiHr.saveKnowledgeDraft(me, input), "Draft saved. It is used once someone approves it."));
export const aiHrApproveKnowledge = async (id: string) => done(await hrRun((me) => aiHr.approveKnowledge(me, id), "Approved and published."));
export const aiHrRollbackKnowledge = async (docKey: string, version: number) => done(await hrRun((me) => aiHr.rollbackKnowledge(me, docKey, version), version ? "Rolled back." : "Withdrawn."));
export const aiHrTestRetrieval = async (q: string) => hrRun((me) => aiHr.testRetrieval(me, q));
export const aiHrAddScenario = async (input: Parameters<typeof aiHr.addScenario>[1]) => done(await hrRun((me) => aiHr.addScenario(me, input), "Scenario added."));
export const aiHrToggleScenario = async (id: string, disabled: boolean) => done(await hrRun((me) => aiHr.toggleScenario(me, id, disabled)));
export const aiHrRunEvaluation = async () => done(await hrRun((me) => aiHr.runEvaluation(me)));
export const aiHrAddWord = async (input: Parameters<typeof aiHr.addWord>[1]) => done(await hrRun((me) => aiHr.addWord(me, input), "The assistant will understand it from now on."));
export const aiHrTeachUnclear = async (turnId: string, input: Parameters<typeof aiHr.addWord>[1]) => done(await hrRun((me) => aiHr.teachFromUnclear(me, turnId, input), "The assistant will understand it from now on."));
export const aiHrDismissUnclear = async (turnId: string) => done(await hrRun((me) => aiHr.dismissUnclear(me, turnId), "Dismissed."));
export const aiHrRemoveWord = async (phrase: string) => done(await hrRun((me) => aiHr.removeWord(me, phrase), "Removed."));
export const aiHrPlayground = async (input: Parameters<typeof aiHr.playground>[1]) => hrRun((me) => aiHr.playground(me, input));
// Employee side
export const aiCallBegin = async (id: string, speak = false) => hrRun((me) => aiHr.beginCall(me, id, { speak }));
export const aiCallTurn = async (fd: FormData) => hrRun((me) => {
  const audio = fd.get("audio");
  return aiHr.sendTurn(me, String(fd.get("id") ?? ""), { text: String(fd.get("text") ?? ""), audio: audio instanceof Blob ? audio : null, speak: fd.get("speak") === "1", sttMs: Number(fd.get("sttMs") ?? 0) });
});
// Naina in Chats
export const aiNainaThread = async () => hrRun(async (me) => ({ thread: await aiHr.nainaThread(me), info: await aiHr.nainaInfo(me) }));
export const aiNainaSend = async (text: string) => hrRun((me) => aiHr.nainaSend(me, text));
export const aiNainaEnd = async () => hrRun((me) => aiHr.nainaEnd(me));
/** The conversation a voice call with Naina joins: the open one, a waiting one, or a new chat. */
export const aiNainaCall = async () => hrRun(async (me) => (await aiHr.nainaConversation(me)).id);
export const aiNainaPushKey = async () => hrRun(async (me) => ({ publicKey: await aiPush.pushPublicKey(), devices: await aiPush.pushDevices(me.id) }));
export const aiNainaPushSave = async (sub: unknown) => hrRun((me) => aiPush.savePushSub(me.id, sub), "Naina can now ring this device, even when the HRMS is closed.");
export const aiNainaPushRemove = async (endpoint: string) => hrRun((me) => aiPush.removePushSub(me.id, String(endpoint).slice(0, 1000)));
export const aiCallEnd = async (id: string) => done(await hrRun((me) => aiHr.endCall(me, id)));
export const aiCallConsent = async (allowed: boolean) => done(await hrRun((me) => aiHr.setConsent(me, allowed), allowed ? "AI conversations are on." : "AI conversations are off. HR can still contact you."));
