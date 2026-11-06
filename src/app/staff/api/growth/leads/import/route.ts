import { UserError } from "@/server/action";
import { growthApi } from "@/staff/growth/api";
import { commitImport, previewImport } from "@/staff/growth/imports";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
/** multipart/form-data: file (.csv/.xlsx), mapping (JSON, optional), source (JSON, for commit), preview=1 to only check. */
export const POST = (req: Request) => growthApi(req, "leads.import", async (a) => {
  const fd = await req.formData();
  const f = fd.get("file");
  if (!(f instanceof File) || !f.size) throw new UserError("Attach a .csv or .xlsx file as “file”.");
  const bytes = new Uint8Array(await f.arrayBuffer());
  const mapping = fd.get("mapping") ? JSON.parse(String(fd.get("mapping"))) : undefined;
  if (fd.get("preview") === "1") return previewImport(a, f.name, bytes, mapping);
  return { job: await commitImport(a, f.name, bytes, mapping, JSON.parse(String(fd.get("source") ?? "{}"))) };
});
