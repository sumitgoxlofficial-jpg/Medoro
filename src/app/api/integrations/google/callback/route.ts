import { timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { getCtx } from "@/server/context";
import { writeAudit } from "@/server/audit";
import { db } from "@/server/db";
import { isSetupDone } from "@/domain/identity/service";
import { setupUnlocked } from "@/server/setup-gate";
import { holdSetupDrive } from "@/server/setup-drive";
import { DriveScopeMissing, exchangeCode, saveDriveToken } from "@/domain/system/gdrive";

const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/** The setup wizard opens consent in a popup and hears back over a BroadcastChannel (Google's pages cut window.opener).
 * The inline script carries the CSP nonce that middleware puts on the request (`x-nonce`). */
const popup = (q: string, nonce: string | null) => new Response(
  `<!doctype html><meta charset="utf-8"><title>Google Drive</title><body style="font:15px system-ui;padding:24px">${q === "ok" ? "Google Drive connected." : "Google Drive wasn’t connected."} You can close this window and go back to <a href="/setup">setup</a>.<script${nonce && /^[A-Za-z0-9+/=]+$/.test(nonce) ? ` nonce="${nonce}"` : ""}>try{new BroadcastChannel("medoro-drive").postMessage(${JSON.stringify(q)})}catch(e){}setTimeout(function(){window.close()},300)</script>`,
  { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } },
);

export async function GET(req: Request) {
  const url = new URL(req.url);
  const c = await cookies();
  const [mode, state, verifier] = (c.get("medoro_gstate")?.value ?? "").split(".");
  c.delete({ name: "medoro_gstate", path: "/api/integrations/google" });
  const setup = mode === "setup";
  const back = (q: string) => setup ? popup(q, req.headers.get("x-nonce")) : Response.redirect(new URL(`/app/backup?drive=${q}`, url.origin), 302);
  if (!state || !verifier || !same(state, url.searchParams.get("state") ?? "")) return back("state");
  const code = url.searchParams.get("code");
  if (!code) return back("denied");
  try {
    if (setup) {
      if ((await isSetupDone()) || !(await setupUnlocked())) return back("forbidden");
      const t = await exchangeCode(code, verifier);
      await holdSetupDrive(t.refreshToken, t.email);
      return back("ok");
    }
    const ctx = await getCtx();
    if (ctx?.readOnly || !ctx || !ctx.perms.includes("integrations")) return back("forbidden");
    const t = await exchangeCode(code, verifier);
    await saveDriveToken(ctx.tenantId, t.refreshToken, t.email);
    await writeAudit(db, { tenantId: ctx.tenantId, userId: ctx.userId, userName: ctx.userName, action: "Google Drive connected", entity: "integration", detail: `${t.email} · scope drive.file` });
    return back("ok");
  } catch (e) {
    return back(e instanceof DriveScopeMissing ? "scope" : "error");
  }
}
