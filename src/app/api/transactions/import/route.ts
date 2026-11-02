import { api } from "@/server/api";
import { UserError } from "@/server/action";
import { importBankStatement } from "@/domain/accounting/bank";
import { MAX_STATEMENT_BYTES } from "@/domain/finance/statement";

export const dynamic = "force-dynamic";
/** Multipart: `file` (CSV / XLSX / XLS), optional `mapping` (JSON). A Drive pharmacy imports on its counter. */
export const POST = api(async (ctx, req) => {
  if (Number(req.headers.get("content-length") ?? 0) > MAX_STATEMENT_BYTES + 64 * 1024) throw new UserError("Statement file is larger than 4 MB.");
  const form = await req.formData();
  const f = form.get("file");
  if (!(f instanceof File)) throw new UserError("Attach the statement as `file`.");
  const raw = form.get("mapping");
  let mapping = null;
  if (typeof raw === "string" && raw) { try { mapping = JSON.parse(raw); } catch { throw new UserError("Column mapping is invalid."); } }
  return importBankStatement(ctx, f.name, new Uint8Array(await f.arrayBuffer()), mapping);
});
