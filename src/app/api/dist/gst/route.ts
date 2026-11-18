import { getDistCtx, distView } from "@/domain/distribution/context";
import { distGstr1, distGstr3b } from "@/domain/distribution/gst";
import { writeAudit } from "@/server/audit";
import { db } from "@/server/db";
import { limited, userKey } from "@/server/ratelimit";

export const dynamic = "force-dynamic";

/** GSTR-1 / GSTR-3B JSON (GSTN offline-tool shape) and the HSN summary as CSV, for distribution invoices. */
export async function GET(req: Request) {
  const ctx = await getDistCtx();
  if (!ctx) return new Response("Sign in again.", { status: 401 });
  try { distView(ctx, "reports"); } catch { return new Response("Your role can't download returns.", { status: 403 }); }
  const block = await limited("report", userKey(ctx));
  if (block) return block;
  const u = new URL(req.url), kind = u.searchParams.get("kind"), gstin = u.searchParams.get("gstin") ?? "", month = u.searchParams.get("month") ?? undefined;
  try {
    let body: string, type = "application/json", name: string;
    if (kind === "gstr3b") { const g = await distGstr3b(ctx, gstin, month); body = JSON.stringify(g.json, null, 2); name = `GSTR3B_${gstin}_${g.json.ret_period}.json`; }
    else {
      const g = await distGstr1(ctx, gstin, month);
      if (kind === "hsn") {
        type = "text/csv; charset=utf-8"; name = `HSN_${gstin}_${g.json.fp}.csv`;
        body = ["Type,HSN,Description,UQC,Rate,Qty,Taxable,IGST,CGST,SGST", ...g.hsn.map((h) => [h.b2b ? "B2B" : "B2C", h.hsn, `"${h.desc}"`, h.uqc, h.rate, h.qty, (h.taxable / 100).toFixed(2), (h.igst / 100).toFixed(2), (h.cgst / 100).toFixed(2), (h.sgst / 100).toFixed(2)].join(","))].join("\n");
      } else { body = JSON.stringify(g.json, null, 2); name = `GSTR1_${gstin}_${g.json.fp}.json`; }
    }
    await writeAudit(db, { tenantId: ctx.tenantId, userId: ctx.userId, userName: ctx.userName, action: "GST file downloaded", entity: "gst", entityId: kind ?? "gstr1", detail: name });
    return new Response(body, { headers: { "content-type": type, "content-disposition": `attachment; filename="${name}"`, "cache-control": "no-store" } });
  } catch (e) {
    return new Response(e instanceof Error ? e.message : "Couldn't build the file.", { status: 400 });
  }
}
