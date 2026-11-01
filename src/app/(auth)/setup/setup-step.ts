import "server-only";
import { UserError } from "@/server/action";
import { isSetupDone } from "@/domain/identity/service";
import { setupUnlocked, signupOpen } from "@/server/setup-gate";

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

/**
 * Restoring a pharmacy from a backup (file or Google Drive) as a new pharmacy: during first-run setup, or on a
 * hosted server with self sign-up, where a returning pharmacy brings its data back like WhatsApp does.
 */
export async function restoreAllowed() {
  return signupOpen() || (!(await isSetupDone()) && (await setupUnlocked()));
}

export async function restoreStep<T>(fn: () => Promise<T>): Promise<R<T>> {
  try {
    if (!(await restoreAllowed())) return { ok: false, error: (await isSetupDone()) ? "This installation is already set up. Sign in instead." : "Enter the setup token first." };
    return { ok: true, data: await fn() };
  } catch (e) {
    if (e instanceof UserError || (e instanceof Error && "status" in e)) return { ok: false, error: e.message };
    console.error(e);
    return { ok: false, error: "Something went wrong. Nothing was changed." };
  }
}
