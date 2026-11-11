import "server-only";
import { after } from "next/server";

/**
 * Runs bookkeeping (last-seen stamps, presence) after the response has been sent, so a page never waits for a write.
 * Outside a request (tests, scripts) or in tests it simply runs and waits, so results are deterministic there.
 */
export async function defer(fn: () => Promise<unknown>): Promise<void> {
  const run = () => fn().then(() => undefined, () => undefined);
  if (process.env.NODE_ENV === "test") return run();
  try { after(run); } catch { void run(); }
}
