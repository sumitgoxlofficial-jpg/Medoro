import { revalidatePath } from "next/cache";
import { run, UserError } from "@/server/action";
import { importBackup } from "@/domain/system/recovery";

/** Restore from an uploaded .mdrbak file (a route, not a server action, so large backups aren't cut off). */
export async function POST(req: Request) {
  const r = await run(async (ctx) => {
    const form = await req.formData().catch(() => null);
    const f = form?.get("file");
    if (!(f instanceof File) || !f.size) throw new UserError("Choose a backup file (.mdrbak).");
    return importBackup(ctx, { bytes: Buffer.from(await f.arrayBuffer()) }, String(form?.get("kit") ?? ""));
  });
  if (r.ok) revalidatePath("/app", "layout");
  return Response.json(r, { status: r.ok ? 200 : 400 });
}
