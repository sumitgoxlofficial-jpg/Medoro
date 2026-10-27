"use server";
import { revalidatePath } from "next/cache";
import { run, UserError } from "@/server/action";
import { IMPORT_KINDS, TEMPLATE_EXAMPLE, previewImport, runImport, templateHeader, type ImportKind } from "@/domain/imports/service";

const MAX_BYTES = 10 * 1024 * 1024;

async function fileOf(fd: FormData) {
  const kind = String(fd.get("kind")) as ImportKind;
  if (!IMPORT_KINDS.includes(kind)) throw new UserError("Choose what to import.");
  const f = fd.get("file");
  if (!(f instanceof File) || !f.size) throw new UserError("Choose a file to upload.");
  if (f.size > MAX_BYTES) throw new UserError("The file is over 10 MB. Split it and import in parts.");
  return { kind, name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) };
}

export async function importPreview(fd: FormData) {
  return run(async (ctx) => { const f = await fileOf(fd); return previewImport(ctx, f.kind, f.name, f.bytes); });
}

export async function importRun(fd: FormData) {
  const r = await run(async (ctx) => { const f = await fileOf(fd); return runImport(ctx, f.kind, f.name, f.bytes); });
  if (r.ok) revalidatePath("/app", "layout");
  return r;
}

export async function importTemplate(kind: ImportKind) {
  return run(async () => [templateHeader(kind), TEMPLATE_EXAMPLE[kind]]);
}
