import "server-only";
import { z } from "zod";
import { db } from "@/server/db";
import { UserError } from "@/server/action";
import { nextSeq } from "@/server/sequence";
import { dateOnly, isoOf, todayISO } from "@/lib/dates";
import { audit, holders, need, notify, type Me } from "./auth";
import { ASSET_KINDS } from "./constants";
import { nameMap } from "./people";
import { raiseTicket } from "./work";

const HR = "_hrms";
export type AssetRow = { id: string; tag: string; name: string; kind: string; assigneeId: string | null; assignee: string; issuedOn: string | null; status: string; note: string };
const out = (a: { id: string; tag: string; name: string; kind: string; assigneeId: string | null; issuedOn: Date | null; status: string; note: string }, names: Map<string, string>): AssetRow =>
  ({ id: a.id, tag: a.tag, name: a.name, kind: a.kind, assigneeId: a.assigneeId, assignee: a.assigneeId ? names.get(a.assigneeId) ?? "" : "", issuedOn: a.issuedOn ? isoOf(a.issuedOn) : null, status: a.status, note: a.note });

export async function myAssets(me: Me) {
  const [rows, names] = await Promise.all([db.hrAsset.findMany({ where: { assigneeId: me.id }, orderBy: { issuedOn: "desc" } }), nameMap()]);
  return rows.map((a) => out(a, names));
}
/** Everything the company owns, for HR. */
export async function allAssets(me: Me) {
  need(me, "employees");
  const [rows, names] = await Promise.all([db.hrAsset.findMany({ orderBy: { tag: "asc" } }), nameMap()]);
  return rows.map((a) => out(a, names));
}
const assetSchema = z.object({ name: z.string().trim().min(2, "Name the item.").max(100), kind: z.enum(ASSET_KINDS), note: z.string().trim().max(200).default(""), assigneeId: z.string().nullish() });
export async function addAsset(me: Me, raw: z.input<typeof assetSchema>) {
  need(me, "employees");
  const i = assetSchema.parse(raw);
  if (i.assigneeId && !(await db.staffUser.findFirst({ where: { id: i.assigneeId, kind: "team", status: "active" } }))) throw new UserError("That employee isn’t active.");
  const n = await db.$transaction((tx) => nextSeq(tx, HR, "AST"));
  const tag = `MS-AST-${String(n).padStart(4, "0")}`;
  await db.hrAsset.create({ data: { tag, name: i.name, kind: i.kind, note: i.note, assigneeId: i.assigneeId || null, issuedOn: i.assigneeId ? dateOnly(todayISO()) : null, status: i.assigneeId ? "in_use" : "in_stock" } });
  if (i.assigneeId) await notify([i.assigneeId], `${i.name} (${tag}) was issued to you.`, "assets");
  await audit(me, "Asset added", `${tag} · ${i.name}`);
  return tag;
}
export async function issueAsset(me: Me, id: string, staffId: string) {
  need(me, "employees");
  const a = await db.hrAsset.findUnique({ where: { id } });
  if (!a) throw new UserError("Asset not found.");
  if (a.status === "lost") throw new UserError("A lost item can’t be issued.");
  if (a.assigneeId) throw new UserError("This item is already issued. Take it back first.");
  if (!(await db.staffUser.findFirst({ where: { id: staffId, kind: "team", status: "active" } }))) throw new UserError("That employee isn’t active.");
  await db.hrAsset.update({ where: { id }, data: { assigneeId: staffId, issuedOn: dateOnly(todayISO()), status: "in_use" } });
  await notify([staffId], `${a.name} (${a.tag}) was issued to you.`, "assets");
  await audit(me, "Asset issued", `${a.tag} → ${staffId}`);
}
export async function returnAsset(me: Me, id: string, status: "in_stock" | "repair" | "lost" = "in_stock") {
  need(me, "employees");
  const a = await db.hrAsset.findUnique({ where: { id } });
  if (!a) throw new UserError("Asset not found.");
  z.enum(["in_stock", "repair", "lost"]).parse(status);
  await db.hrAsset.update({ where: { id }, data: { assigneeId: null, issuedOn: null, status } });
  await audit(me, "Asset taken back", `${a.tag} · ${status}`);
}
export async function setAssetStatus(me: Me, id: string, status: string) {
  need(me, "employees");
  const st = z.enum(["in_use", "in_stock", "repair", "lost"]).parse(status);
  const a = await db.hrAsset.findUnique({ where: { id } });
  if (!a) throw new UserError("Asset not found.");
  if (st === "in_use" && !a.assigneeId) throw new UserError("Issue the item to someone to mark it in use.");
  await db.hrAsset.update({ where: { id }, data: { status: st } });
}
/** An employee reports a problem with their own item: it becomes an HR support ticket and the item is marked for repair. */
export async function reportIssue(me: Me, id: string, note: string) {
  const a = await db.hrAsset.findFirst({ where: { id, assigneeId: me.id } });
  if (!a) throw new UserError("That item isn’t issued to you.");
  const text = z.string().trim().min(5, "Say what is wrong, in a few words.").max(500).parse(note);
  const code = await raiseTicket(me, { category: "IT & access", subject: `Asset issue: ${a.name} (${a.tag})`, body: text });
  await db.hrAsset.update({ where: { id }, data: { status: "repair" } });
  void holders; // HR is notified by the ticket
  return code;
}
