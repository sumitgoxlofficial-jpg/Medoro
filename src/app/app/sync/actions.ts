"use server";
import { revalidatePath } from "next/cache";
import { run } from "@/server/action";
import { disableDevice, enableDevice, resolveOp } from "@/domain/sales/offline";

const done = <T,>(r: T) => { revalidatePath("/app/sync"); return r; };
export const enableOfflineAction = async (name: string) => done(await run(async (ctx) => ({ ...(await enableDevice(ctx, name)), tenant: ctx.tenantId, branchId: ctx.branchId }), "Offline billing is on for this device."));
export const disableOfflineAction = async (deviceId: string) => done(await run((ctx) => disableDevice(ctx, deviceId), "Offline billing turned off for that device."));
export const resolveOfflineAction = async (opId: string, action: "repost" | "close", note: string) =>
  done(await run((ctx) => resolveOp(ctx, opId, action, note), action === "repost" ? "Bill posted from current stock." : "Bill closed with your note."));
