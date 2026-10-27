import { cookies } from "next/headers";
import { getCtx } from "@/server/context";
import { writeAudit } from "@/server/audit";
import { db } from "@/server/db";
import { exchangeCode } from "@/domain/system/gdrive";

export async function GET(req: Request) {
  const ctx = await getCtx();
  const url = new URL(req.url);
  const back = (q: string) => Response.redirect(new URL(`/app/backup?${q}`, url.origin), 302);
  if (!ctx || !ctx.perms.includes("integrations")) return back("drive=forbidden");
  const c = await cookies();
  const state = c.get("medoro_gstate")?.value;
  c.delete("medoro_gstate");
  if (!state || state !== url.searchParams.get("state")) return back("drive=state");
  const code = url.searchParams.get("code");
  if (!code) return back("drive=denied");
  try {
    const email = await exchangeCode(ctx.tenantId, code);
    await writeAudit(db, { tenantId: ctx.tenantId, userId: ctx.userId, userName: ctx.userName, action: "Google Drive connected", entity: "integration", detail: `${email ?? ""} · scope drive.file` });
    return back("drive=ok");
  } catch {
    return back("drive=error");
  }
}
