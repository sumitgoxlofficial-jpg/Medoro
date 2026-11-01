import { restoreStep } from "@/app/(auth)/setup/setup-step";
import { UserError } from "@/server/action";
import { dropSetupDrive, setupDrive } from "@/server/setup-drive";
import { freshRestore, previewFreshRestore } from "@/domain/system/recovery";

/** First-run restore from an uploaded backup file: step "check" previews it, step "restore" restores it. */
export async function POST(req: Request) {
  const r = await restoreStep(async () => {
    const form = await req.formData().catch(() => null);
    const f = form?.get("file");
    if (!(f instanceof File) || !f.size) throw new UserError("Choose the backup file (.mdrbak).");
    const bytes = Buffer.from(await f.arrayBuffer()), kit = String(form?.get("kit") ?? "");
    if (form?.get("step") !== "restore") return previewFreshRestore(bytes, kit);
    const drive = await setupDrive();
    const done = await freshRestore(bytes, kit, String(form?.get("code") ?? ""), drive);
    if (drive) await dropSetupDrive();
    return done;
  });
  return Response.json(r, { status: r.ok ? 200 : 400 });
}
