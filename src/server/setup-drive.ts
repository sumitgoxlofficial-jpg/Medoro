import "server-only";
import { cookies } from "next/headers";
import { seal, unseal } from "./vault";
import { saveDriveToken } from "@/domain/system/gdrive";

// During first-run setup there is no pharmacy to store a Google token on yet, so the browser holds it in a
// sealed, httpOnly cookie until setup (or a restore) creates the pharmacy and adopts it.
const COOKIE = "medoro_gsetup";

export async function holdSetupDrive(refreshToken: string, account: string) {
  (await cookies()).set(COOKIE, seal(JSON.stringify({ refreshToken, account })).toString("base64url"), { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 2 * 3600 });
}

export async function setupDrive(): Promise<{ refreshToken: string; account: string } | null> {
  const v = (await cookies()).get(COOKIE)?.value;
  if (!v) return null;
  try { return JSON.parse(unseal(Buffer.from(v, "base64url")).toString()); } catch { return null; }
}

export async function dropSetupDrive() {
  (await cookies()).delete(COOKIE);
}

/** After setup creates the pharmacy, the Drive connected during setup becomes its Drive. */
export async function adoptSetupDrive(tenantId: string) {
  const d = await setupDrive();
  if (!d) return false;
  await saveDriveToken(tenantId, d.refreshToken, d.account);
  await dropSetupDrive();
  return true;
}
