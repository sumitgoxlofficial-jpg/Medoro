"use server";
import { revalidatePath } from "next/cache";
import type { ActionResult } from "@/server/action";
import { hrRun } from "@/staff/hrms/auth";
import * as tr from "@/staff/hrms/training/service";

// Server actions of the Sales Training Academy. Every rule and permission check lives in training/service.ts.
const done = <T,>(r: ActionResult<T>) => { if (r.ok) revalidatePath("/staff/hrms", "layout"); return r; };

// Learner (heartbeats and exam questions don't refresh the page)
export const trBeat = async (input: unknown) => hrRun((me) => tr.beat(me, input));
export const trLesson = async (lessonId: string) => hrRun((me) => tr.lessonForLearner(me, lessonId));
export const trExam = async (kind: "product" | "final") => hrRun((me) => tr.examForLearner(me, kind));
export const trSubmitQuiz = async (input: unknown) => done(await hrRun((me) => tr.submitQuiz(me, input)));
export const trAttempt = async (id: string) => hrRun((me) => tr.attemptReview(me, id));
export const trSubmitPractical = async (input: unknown) => done(await hrRun((me) => tr.submitPractical(me, input), "Submitted. Your trainer will score it."));

// Trainer (and HR)
export const trAttendance = async (id: string, v: "present" | "absent" | "") => done(await hrRun((me) => tr.markAttendance(me, id, v), "Attendance saved."));
export const trScore = async (id: string, rubric: Record<string, number>, feedback: string) => done(await hrRun((me) => tr.evaluatePractical(me, id, rubric, feedback), "Score saved and shared with the employee."));
export const trTrainerDecide = async (id: string, approve: boolean, feedback: string) => done(await hrRun((me) => tr.trainerDecide(me, id, approve, feedback)));
export const trReopen = async (id: string) => done(await hrRun((me) => tr.reopen(me, id), "Reopened. The employee can continue."));

// HR / admin
export const trInstall = async () => done(await hrRun((me) => tr.installStandardCourse(me)));
export const trSaveSettings = async (input: unknown) => done(await hrRun((me) => tr.saveTrainingSettings(me, input), "Settings saved."));
export const trCreateBatch = async (input: unknown, staffIds: string[]) => done(await hrRun((me) => tr.createBatch(me, input, staffIds)));
export const trUpdateBatch = async (id: string, input: unknown, status: "scheduled" | "closed") => done(await hrRun((me) => tr.updateBatch(me, id, input, status), "Batch saved."));
export const trAssign = async (batchId: string, staffIds: string[]) => done(await hrRun((me) => tr.assign(me, batchId, staffIds)));
export const trMove = async (id: string, batchId: string) => done(await hrRun((me) => tr.moveAssignment(me, id, batchId), "Moved."));
export const trUnassign = async (id: string) => done(await hrRun((me) => tr.unassign(me, id), "Removed from the programme."));
export const trGrantAttempt = async (id: string) => done(await hrRun((me) => tr.grantAttempt(me, id), "One more attempt allowed."));
export const trHrDecide = async (id: string, approve: boolean, note: string) => done(await hrRun((me) => tr.hrDecide(me, id, approve, note)));
export const trRevoke = async (id: string, reason: string) => done(await hrRun((me) => tr.revokeCertificate(me, id, reason), "Certificate revoked."));
export const trReport = async () => hrRun((me) => tr.reportCsv(me));
export const trSaveLesson = async (id: string, input: unknown) => done(await hrRun((me) => tr.saveLesson(me, id, input), "Lesson saved (new version)."));
export const trCreateLesson = async (moduleId: string, title: string) => done(await hrRun((me) => tr.createLesson(me, moduleId, title), "Draft lesson added."));
export const trVersions = async (lessonId: string) => hrRun((me) => tr.lessonVersions(me, lessonId));
export const trRestore = async (versionId: string) => done(await hrRun((me) => tr.restoreVersion(me, versionId), "Version restored."));
export const trSaveModule = async (id: string | null, input: unknown) => done(await hrRun((me) => tr.saveModule(me, id, input), "Module saved."));
export const trSaveQuestion = async (id: string | null, input: unknown) => done(await hrRun((me) => tr.saveQuestion(me, id, input), "Question saved."));
export const trSaveScenario = async (id: string | null, input: unknown) => done(await hrRun((me) => tr.saveScenario(me, id, input), "Scenario saved."));
export const trSaveSchedule = async (rows: unknown) => done(await hrRun((me) => tr.saveSchedule(me, rows), "Schedule saved."));
export const trUpload = async (lessonId: string, form: FormData) => done(await hrRun((me) => tr.uploadResource(me, lessonId, form), "File uploaded."));
export const trAddLink = async (lessonId: string, name: string, url: string) => done(await hrRun((me) => tr.addResourceLink(me, lessonId, name, url), "Link added."));
export const trRemoveResource = async (lessonId: string, index: number) => done(await hrRun((me) => tr.removeResource(me, lessonId, index), "Removed."));
