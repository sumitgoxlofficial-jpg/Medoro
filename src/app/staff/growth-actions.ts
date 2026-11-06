"use server";
import { revalidatePath } from "next/cache";
import { UserError, type ActionResult } from "@/server/action";
import { growthRun } from "@/staff/growth/access";
import * as leads from "@/staff/growth/leads";
import * as imports from "@/staff/growth/imports";
import * as verify from "@/staff/growth/verify";
import * as dist from "@/staff/growth/distribution";
import * as team from "@/staff/growth/team";
import * as calls from "@/staff/growth/calls";
import * as fu from "@/staff/growth/followups";
import * as pipe from "@/staff/growth/pipeline";
import * as comms from "@/staff/growth/comms";
import * as comp from "@/staff/growth/compliance";
import * as ai from "@/staff/growth/ai";
import * as disc from "@/staff/growth/discovery";
import * as jobs from "@/staff/growth/jobs";
import { need } from "@/staff/growth/access";

// Server actions for Growth Intelligence. Each one re-checks the session, the Growth role and the permission on the server.
const done = <T,>(r: ActionResult<T>) => { if (r.ok) revalidatePath("/staff/growth", "layout"); return r; };
const bytes = async (f: File) => new Uint8Array(await f.arrayBuffer());
const file = (fd: FormData) => { const f = fd.get("file"); if (!(f instanceof File) || !f.size) throw new UserError("Choose a .csv or .xlsx file."); return f; };

// Leads
export const createLead = async (i: Parameters<typeof leads.createLead>[1]) => done(await growthRun((a) => leads.createLead(a, i), "Lead added."));
export const updateLead = async (id: string, i: Parameters<typeof leads.updateLead>[2]) => done(await growthRun((a) => leads.updateLead(a, id, i), "Lead saved."));
export const addNote = async (id: string, text: string) => done(await growthRun((a) => leads.addNote(a, id, text), "Note added."));
export const addContact = async (id: string, i: Parameters<typeof leads.addContact>[2]) => done(await growthRun((a) => leads.addContact(a, id, i), "Contact added."));
export const exportLeads = async (f: leads.LeadFilter, purpose: string) => growthRun((a) => leads.exportLeads(a, f, purpose));
export const saveSource = async (i: Parameters<typeof leads.saveSource>[1]) => done(await growthRun((a) => leads.saveSource(a, i), "Source saved."));
export const rescoreLeads = async (ids: string[]) => done(await growthRun((a) => leads.rescoreLeads(a, ids), "Scores recomputed."));

// Import
export const previewImport = async (fd: FormData, mapping?: Record<string, number>, requirePhone = true) => growthRun(async (a) => { const f = file(fd); return imports.previewImport(a, f.name, await bytes(f), mapping, requirePhone); });
export const commitImport = async (fd: FormData, mapping: Record<string, number> | undefined, source: Parameters<typeof imports.commitImport>[4]) => done(await growthRun(async (a) => { const f = file(fd); return imports.commitImport(a, f.name, await bytes(f), mapping, source); }));
export const continueImport = async (id: string) => done(await growthRun((a) => imports.continueImport(a, id)));
export const importErrors = async (id: string) => growthRun((a) => imports.importErrorsCsv(a, id));
export const startDiscovery = async (i: Parameters<typeof disc.startDiscovery>[1]) => done(await growthRun((a) => disc.startDiscovery(a, i)));

// Verification
export const verifyLead = async (id: string, i: Parameters<typeof verify.verifyLead>[2]) => done(await growthRun((a) => verify.verifyLead(a, id, i), "Verified, with the evidence recorded."));
export const withdrawVerification = async (id: string, kind: verify.VerifyKind, reason: string) => done(await growthRun((a) => verify.withdrawVerification(a, id, kind, reason), "Verification withdrawn."));
export const checkWebsite = async (id: string) => done(await growthRun((a) => verify.checkWebsite(a, id)));
export const markInvalid = async (id: string, reason: string | null) => done(await growthRun((a) => verify.markInvalid(a, id, reason), reason ? "Marked invalid." : "Invalid mark cleared."));
export const dismissDuplicate = async (id: string) => done(await growthRun((a) => verify.dismissDuplicate(a, id), "Kept as separate pharmacies."));
export const mergeDuplicate = async (id: string, keepId: string) => done(await growthRun((a) => verify.mergeDuplicate(a, id, keepId), "Merged. The other record is kept as history."));

// Distribution and team
export const assignLeads = async (i: Parameters<typeof dist.assignLeads>[1]) => done(await growthRun((a) => dist.assignLeads(a, i)));
export const distribute = async (i: Parameters<typeof dist.distribute>[1]) => done(await growthRun((a) => dist.distribute(a, i)));
export const assignByTerritory = async (i: Parameters<typeof dist.assignByTerritory>[1]) => done(await growthRun((a) => dist.assignByTerritory(a, i)));
export const withdrawLeads = async (ids: string[], reason: string) => done(await growthRun((a) => dist.withdraw(a, ids, reason)));
export const reassignFrom = async (from: string, to: string[]) => done(await growthRun((a) => dist.reassignFrom(a, from, to)));
export const patchAssignment = async (id: string, i: Parameters<typeof dist.patchAssignment>[2]) => done(await growthRun((a) => dist.patchAssignment(a, id, i), "Assignment updated."));
export const setMember = async (i: Parameters<typeof team.setMember>[1]) => done(await growthRun((a) => team.setMember(a, i), "Growth role saved."));
export const saveTeam = async (i: Parameters<typeof team.saveTeam>[1]) => done(await growthRun((a) => team.saveTeam(a, i), "Team saved."));
export const addTerritory = async (staffId: string, i: Parameters<typeof team.addTerritory>[2]) => done(await growthRun((a) => team.addTerritory(a, staffId, i), "Territory added."));
export const removeTerritory = async (id: string) => done(await growthRun((a) => team.removeTerritory(a, id), "Territory removed."));
export const decideEmployee = async (staffId: string, approve: boolean, teamId: string | null) => done(await growthRun((a) => team.decideEmployee(a, staffId, approve, teamId), approve ? "Approved. They can sign in with Google now." : "Sign-up rejected."));
export const setTarget = async (i: Parameters<typeof team.setTarget>[1]) => done(await growthRun((a) => team.setTarget(a, i), "Target saved."));

// Calls and follow-ups
export const launchCall = async (leadId: string) => done(await growthRun((a) => calls.launchCall(a, leadId)));
export const reportCall = async (sessionId: string, i: Parameters<typeof calls.reportCall>[2]) => done(await growthRun((a) => calls.reportCall(a, sessionId, i), "Call report saved."));
export const createFollowUp = async (i: Parameters<typeof fu.createFollowUp>[1]) => done(await growthRun((a) => fu.createFollowUp(a, i), "Follow-up scheduled."));
export const updateFollowUp = async (id: string, i: Parameters<typeof fu.updateFollowUp>[2]) => done(await growthRun((a) => fu.updateFollowUp(a, id, i), "Follow-up updated."));

// Pipeline
export const setStage = async (id: string, i: Parameters<typeof pipe.setStage>[2]) => done(await growthRun((a) => pipe.setStage(a, id, i), "Stage updated."));
export const bookDemo = async (i: Parameters<typeof pipe.bookDemo>[1]) => done(await growthRun((a) => pipe.bookDemo(a, i), "Demo booked."));
export const updateDemo = async (id: string, status: "completed" | "no_show" | "cancelled", notes = "") => done(await growthRun((a) => pipe.updateDemo(a, id, status, notes), "Demo updated."));
export const convertLead = async (id: string, i: Parameters<typeof pipe.convertLead>[2]) => done(await growthRun((a) => pipe.convertLead(a, id, i), "Conversion recorded."));
export const startTrial = async (id: string) => done(await growthRun((a) => pipe.startTrial(a, id), "Trial started."));
export const handOff = async (id: string, product: "starter" | "pro" | "multi") => done(await growthRun((a) => pipe.handOffToPipeline(a, id, product)));

// Communications
export const sendMessage = async (i: Parameters<typeof comms.sendMessage>[1]) => done(await growthRun((a) => comms.sendMessage(a, i), "Message sent."));
export const saveTemplate = async (i: Parameters<typeof comms.saveTemplate>[1]) => done(await growthRun((a) => comms.saveTemplate(a, i), "Template saved as a draft."));
export const approveTemplate = async (id: string) => done(await growthRun((a) => comms.approveTemplate(a, id), "Template approved."));
export const syncWaTemplates = async () => done(await growthRun((a) => comms.syncWaTemplates(a)));
export const createCampaign = async (i: Parameters<typeof comms.createCampaign>[1]) => done(await growthRun((a) => comms.createCampaign(a, i), "Campaign created and sent for approval."));
export const audiencePreview = async (channel: "whatsapp" | "email", audience: Record<string, unknown>) => growthRun((a) => comms.audiencePreview(a, channel, audience));
export const approveCampaign = async (id: string, reviewed: boolean) => done(await growthRun((a) => comms.approveCampaign(a, id, reviewed), "Approved. Messages go out in batches within the daily cap."));
export const cancelCampaign = async (id: string) => done(await growthRun((a) => comms.cancelCampaign(a, id), "Campaign cancelled."));
export const connectWhatsApp = async (i: Parameters<typeof comms.connectWhatsApp>[1]) => done(await growthRun((a) => comms.connectWhatsApp(a, i), "WhatsApp connected."));
export const disconnect = async (kind: "whatsapp" | "email") => done(await growthRun((a) => comms.disconnect(a, kind), "Disconnected."));
export const startEmailSetup = async (i: Parameters<typeof comms.startEmailSetup>[1]) => done(await growthRun((a) => comms.startEmailSetup(a, i), "Test email sent to you. Enter the code from it."));
export const confirmEmailSetup = async (code: string) => done(await growthRun((a) => comms.confirmEmailSetup(a, code), "Email sender confirmed."));
export const openThread = async (id: string) => growthRun((a) => comms.thread(a, id));

// Compliance
export const recordConsent = async (i: Parameters<typeof comp.recordConsent>[1]) => done(await growthRun((a) => comp.recordConsent(a, i), "Consent recorded."));
export const revokeConsent = async (id: string, note: string) => done(await growthRun((a) => comp.revokeConsent(a, id, note), "Consent revoked."));
export const suppress = async (i: Parameters<typeof comp.suppress>[1]) => done(await growthRun((a) => comp.suppress(a, i), "Added to the do-not-contact list."));
export const liftSuppression = async (id: string, note: string) => done(await growthRun((a) => comp.liftSuppression(a, id, note), "Do-not-contact entry lifted."));
export const eraseLead = async (id: string, reason: string) => done(await growthRun((a) => comp.eraseLead(a, id, reason), "Personal data erased."));
export const runRetention = async () => done(await growthRun((a) => comp.runRetention(a)));
export const savePolicy = async (i: Parameters<typeof comp.savePolicy>[1]) => done(await growthRun((a) => comp.savePolicy(a, i), "Contact policy saved."));

// AI
export const aiResearch = async (leadId: string) => growthRun((a) => ai.research(a, leadId));
export const aiDraft = async (i: Parameters<typeof ai.draftMessage>[1]) => growthRun((a) => ai.draftMessage(a, i));
export const aiDemoPrep = async (leadId: string) => growthRun((a) => ai.demoPrep(a, leadId));

// Jobs
export const runJobsNow = async () => done(await growthRun(async (a) => { need(a, "jobs.run"); return jobs.runJobs(new Date(), 20_000); }));
export const retryJob = async (id: string) => done(await growthRun(async (a) => { need(a, "jobs.run"); return jobs.retryJob(id); }, "Job queued again."));
