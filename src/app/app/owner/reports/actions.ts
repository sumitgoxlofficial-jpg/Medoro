"use server";
import { revalidatePath } from "next/cache";
import { run } from "@/server/action";
import { saveReportMail, sendReportsNow } from "@/domain/reports/mailer";

const fresh = <T,>(r: T) => { revalidatePath("/app/owner/reports"); return r; };
export async function saveReportMailAction(input: Parameters<typeof saveReportMail>[1]) { return fresh(await run((c) => saveReportMail(c, input), "Saved.")); }
export async function sendNowAction() { return fresh(await run((c) => sendReportsNow(c))); }
