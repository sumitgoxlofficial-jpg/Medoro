import "server-only";
import { UserError } from "@/server/action";
import { isSetupDone } from "@/domain/identity/service";
import { setupUnlocked } from "@/server/setup-gate";

type R<T> = { ok: true; data: T } | { ok: false; error: string };

/** First-run setup actions are open only while the database is empty and setup is unlocked. */
export async function setupStep<T>(fn: () => Promise<T>): Promise<R<T>> {
  try {
    if (await isSetupDone()) return { ok: false, error: "This installation is already set up. Sign in instead." };
    if (!(await setupUnlocked())) return { ok: false, error: "Enter the setup token first." };
    return { ok: true, data: await fn() };
  } catch (e) {
    if (e instanceof UserError || (e instanceof Error && "status" in e)) return { ok: false, error: e.message };
    console.error(e);
    return { ok: false, error: "Something went wrong. Nothing was changed." };
  }
}
