"use server";
import { revalidatePath } from "next/cache";
import { run } from "@/server/action";
import { fixDay, monthOf, punchIn, punchOut } from "@/domain/identity/attendance";

const done = <T,>(r: T) => { revalidatePath("/app/attendance"); return r; };

export async function punchInAction() { return done(await run((c) => punchIn(c), "Punched in.")); }
export async function punchOutAction() { return done(await run((c) => punchOut(c), "Punched out.")); }
export async function fixDayAction(input: Parameters<typeof fixDay>[1]) { return done(await run((c) => fixDay(c, input), "Attendance saved.")); }
export async function personMonthAction(userId: string, ym: string) { return run((c) => monthOf(c, ym, userId)); }
