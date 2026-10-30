import "server-only";
import { randomBytes } from "node:crypto";
import { db, type DbOrTx } from "@/server/db";
import { writeAudit } from "@/server/audit";
import type { Ctx } from "@/server/context";
import { UserError } from "@/server/action";
import { readDocument, restoreFile } from "@/server/storage";

/**
 * Full restore of one pharmacy from a backup, in two steps:
 *   1. prepare: decrypt the backup into a test copy (a separate Postgres schema), check it, and compare it with live data;
 *   2. apply: after the owner confirms, take a safety backup, then replace the pharmacy's live rows with the test copy in one transaction.
 * Integrations (WhatsApp, Drive, the backup key), backup history and the licence stay as they are on this server.
 * Stored files (invoice scans) travel in the backup as `files` and are written back to this server's storage.
 */

export const BACKUP_FORMAT = "medoro-backup-v2";
/** Tenant tables kept as they are on this server. FileObject only indexes storage; file contents travel as `files`. */
const KEEP = new Set(["Integration", "BackupManifest", "SubscriptionMeta", "LicenceOutbox", "RestoreRun", "FileObject"]);
/** Tenant rows that are cleared, not restored: everyone signs in again after a restore, and pending reset codes die. */
const CLEAR = new Set(["Session", "AiConfirmation", "AuthCode", "DiscountApproval"]);
/** Tables that don't belong to any pharmacy. */
const GLOBAL = new Set(["Tenant", "LoginAttempt", "AiAsk", "OtpCode", "StaffUser", "StaffSession", "StaffBank", "StaffAudit", "CpSetting", "CpCustomer", "CpNote", "Lead", "LeadLog", "CpSale", "Ticket", "TicketMessage", "RemoteAccessRequest", "CpBillingEvent"]);

type Layout = {
  /** Restored tables in insert order (parents first). Child tables have `via`: the FK column and its tenant-owned parent. */
  tables: { name: string; via?: { col: string; parent: string } }[];
  clear: { name: string; via?: { col: string; parent: string } }[];
  edges: { table: string; col: string; parent: string }[];
};

const q = (id: string) => `"${id.replace(/"/g, '""')}"`;

export async function layout(client: DbOrTx = db): Promise<Layout> {
  const cols = await client.$queryRaw<{ t: string; c: string }[]>`SELECT table_name t, column_name c FROM information_schema.columns WHERE table_schema = 'public'`;
  const fks = await client.$queryRaw<{ t: string; c: string; p: string }[]>`
    SELECT tc.table_name t, kcu.column_name c, ccu.table_name p FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
    JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
    WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public'`;
  const all = [...new Set(cols.map((x) => x.t))].filter((t) => t !== "_prisma_migrations");
  const hasTenant = new Set(cols.filter((x) => x.c === "tenantId").map((x) => x.t));
  const owned = new Map<string, { col: string; parent: string } | undefined>();
  for (const t of all) if (hasTenant.has(t) && !GLOBAL.has(t)) owned.set(t, undefined);
  for (const f of fks) if (!hasTenant.has(f.t) && !GLOBAL.has(f.t) && owned.has(f.p) && !owned.get(f.p)) owned.set(f.t, { col: f.c, parent: f.p });
  const unknown = all.filter((t) => !owned.has(t) && !GLOBAL.has(t));
  if (unknown.length) throw new Error(`Restore doesn’t know how to handle table(s): ${unknown.join(", ")}.`);

  const restored = [...owned.keys()].filter((t) => !KEEP.has(t) && !CLEAR.has(t));
  const edges = fks.filter((f) => restored.includes(f.t) && restored.includes(f.p) && f.t !== f.p).map((f) => ({ table: f.t, col: f.c, parent: f.p }));
  // Topological order: a table comes after every table it references.
  const order: string[] = [], seen = new Set<string>();
  const visit = (t: string, stack: string[]) => {
    if (seen.has(t)) return;
    if (stack.includes(t)) throw new Error(`Foreign-key cycle: ${[...stack, t].join(" → ")}`);
    for (const e of edges.filter((x) => x.table === t)) visit(e.parent, [...stack, t]);
    seen.add(t); order.push(t);
  };
  restored.sort().forEach((t) => visit(t, []));
  return {
    tables: order.map((name) => ({ name, via: owned.get(name) })),
    clear: [...CLEAR].filter((t) => owned.has(t)).map((name) => ({ name, via: owned.get(name) })),
    edges,
  };
}

/** WHERE clause selecting a pharmacy's rows in `schema`.`table`. */
const scope = (schema: string, t: { name: string; via?: { col: string; parent: string } }) =>
  t.via ? `${q(t.via.col)} IN (SELECT id FROM ${q(schema)}.${q(t.via.parent)} WHERE "tenantId" = $1)` : `"tenantId" = $1`;

/** Every row of every restorable table for one pharmacy, as stored. Used for backups. */
export async function dumpForBackup(tenantId: string) {
  const L = await layout();
  const tables: Record<string, unknown[]> = {};
  for (const t of L.tables) {
    const r = await db.$queryRawUnsafe<{ rows: unknown[] }[]>(`SELECT coalesce(json_agg(x), '[]'::json) AS rows FROM ${q(t.name)} x WHERE ${scope("public", t)}`, tenantId);
    tables[t.name] = r[0].rows;
  }
  const tenant = await db.tenant.findUniqueOrThrow({ where: { id: tenantId } });
  const files: BackupFile[] = [], missingFiles: string[] = [];
  const docs = await db.scanDocument.findMany({ where: { tenantId, storagePath: { not: null } }, select: { storagePath: true, mime: true } });
  for (const [key, mime] of new Map(docs.map((d) => [d.storagePath!, d.mime]))) {
    const b = await readDocument(key).catch(() => null);
    if (b) files.push({ key, contentType: mime ?? "application/octet-stream", data: b.toString("base64") });
    else missingFiles.push(key);
  }
  const data: RestoreData = { format: BACKUP_FORMAT, exportedAt: new Date().toISOString(), tenant: { id: tenant.id, code: tenant.code, name: tenant.name, legalName: tenant.legalName, gstin: tenant.gstin, phone: tenant.phone, settings: tenant.settings }, tables, files };
  return { data, missingFiles };
}

export type BackupFile = { key: string; contentType: string; data: string };
export type RestoreData = {
  format: string; exportedAt: string; tables: Record<string, unknown[]>;
  tenant: { id: string; code: string; name: string; legalName: string | null; gstin: string | null; phone: string | null; settings: unknown };
  /** Absent in backups made before files were included. */
  files?: BackupFile[];
};
export const isRestorable = (d: Record<string, unknown>): d is RestoreData => d.format === BACKUP_FORMAT && !!d.tables;

type Figures = { sales: number; salesTotal: number; lastSale: string | null; medicines: number; stockUnits: number; customers: number; suppliers: number; vouchers: number };
async function figures(client: DbOrTx, schema: string, tenantId: string): Promise<Figures> {
  const one = async <T,>(sql: string) => (await client.$queryRawUnsafe<T[]>(sql, tenantId))[0];
  const s = q(schema);
  const sale = await one<{ n: bigint; total: bigint | null; last: Date | null }>(`SELECT count(*) n, sum("totalPaise") total, max(at) last FROM ${s}."Sale" WHERE "tenantId" = $1`);
  const c = await one<{ m: bigint; u: bigint | null; cu: bigint; su: bigint; v: bigint }>(`SELECT
    (SELECT count(*) FROM ${s}."Medicine" WHERE "tenantId" = $1) m, (SELECT sum("qtyAvailable") FROM ${s}."Batch" WHERE "tenantId" = $1) u,
    (SELECT count(*) FROM ${s}."Customer" WHERE "tenantId" = $1) cu, (SELECT count(*) FROM ${s}."Supplier" WHERE "tenantId" = $1) su,
    (SELECT count(*) FROM ${s}."Voucher" WHERE "tenantId" = $1) v`);
  return { sales: Number(sale.n), salesTotal: Number(sale.total ?? 0), lastSale: sale.last?.toISOString() ?? null, medicines: Number(c.m), stockUnits: Number(c.u ?? 0), customers: Number(c.cu), suppliers: Number(c.su), vouchers: Number(c.v) };
}

export type RestoreSummary = {
  backupAt: string; tables: { name: string; backup: number; live: number }[]; backupFigures: Figures; liveFigures: Figures;
  problems: string[]; notes: string[];
};

/** Loads a decrypted backup into a new test-copy schema and compares it with live data. Live data is not touched. */
export async function prepare(tenantId: string, data: RestoreData, createdAt: string) {
  if (data.tenant.id !== tenantId) throw new UserError("This backup belongs to a different pharmacy.");
  const L = await layout();
  const schema = `restore_${randomBytes(5).toString("hex")}`;
  const notes: string[] = [], problems: string[] = [];
  const liveCols = new Map<string, string[]>();
  for (const r of await db.$queryRaw<{ t: string; c: string }[]>`SELECT table_name t, column_name c FROM information_schema.columns WHERE table_schema = 'public' ORDER BY ordinal_position`)
    liveCols.set(r.t, [...(liveCols.get(r.t) ?? []), r.c]);
  try {
    await db.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`CREATE SCHEMA ${q(schema)}`);
      for (const t of L.tables) {
        await tx.$executeRawUnsafe(`CREATE TABLE ${q(schema)}.${q(t.name)} (LIKE public.${q(t.name)} INCLUDING DEFAULTS)`);
        const rows = (data.tables[t.name] ?? []) as Record<string, unknown>[];
        if (!(t.name in data.tables)) notes.push(`${t.name} isn’t in this backup (added in a later version); it will be empty.`);
        if (!rows.length) continue;
        const have = new Set(Object.keys(rows[0]));
        const cols = (liveCols.get(t.name) ?? []).filter((c) => have.has(c));
        const extra = [...have].filter((c) => !(liveCols.get(t.name) ?? []).includes(c));
        if (extra.length) notes.push(`${t.name}: ignored old column(s) ${extra.join(", ")}.`);
        const list = cols.map(q).join(", ");
        for (let i = 0; i < rows.length; i += 2000) {
          await tx.$executeRawUnsafe(`INSERT INTO ${q(schema)}.${q(t.name)} (${list}) SELECT ${list} FROM json_populate_recordset(NULL::public.${q(t.name)}, $1::json)`, JSON.stringify(rows.slice(i, i + 2000)));
        }
      }
      // Every reference inside the copy must resolve, or the live swap would fail halfway.
      for (const e of L.edges) {
        const r = await tx.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*) n FROM ${q(schema)}.${q(e.table)} c WHERE c.${q(e.col)} IS NOT NULL AND NOT EXISTS (SELECT 1 FROM ${q(schema)}.${q(e.parent)} p WHERE p.id = c.${q(e.col)})`);
        if (Number(r[0].n)) problems.push(`${Number(r[0].n)} ${e.table} row(s) point to a missing ${e.parent}.`);
      }
    }, { timeout: 300_000 });
    const tables = [];
    for (const t of L.tables) {
      const b = await db.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*) n FROM ${q(schema)}.${q(t.name)}`);
      const l = await db.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*) n FROM public.${q(t.name)} WHERE ${scope("public", t)}`, tenantId);
      tables.push({ name: t.name, backup: Number(b[0].n), live: Number(l[0].n) });
    }
    const files = data.files ?? [];
    if (!data.files) notes.push("This backup was made before stored files (invoice scans) were included; the files on this server stay as they are.");
    else if (files.length) notes.push(`${files.length} stored file(s) (invoice scans) will be written back.`);
    if (files.some((f) => !f.key.startsWith(tenantId + "/"))) problems.push("The backup contains files of another pharmacy.");
    const summary: RestoreSummary = { backupAt: createdAt, tables, backupFigures: await figures(db, schema, tenantId), liveFigures: await figures(db, "public", tenantId), problems, notes };
    return { schema, summary };
  } catch (e) {
    await dropSchema(schema);
    throw e instanceof UserError ? e : new UserError(`The backup couldn’t be loaded into a test copy: ${e instanceof Error ? e.message.slice(0, 200) : "unknown error"}. Live data is unchanged.`);
  }
}

export async function dropSchema(schema: string) {
  if (!/^restore_[0-9a-f]{10}$/.test(schema)) return;
  await db.$executeRawUnsafe(`DROP SCHEMA IF EXISTS ${q(schema)} CASCADE`).catch(() => {});
}

/** Writes the backup's stored files back. Files are named by content hash, so this is safe to repeat. */
export async function restoreFiles(data: RestoreData) {
  for (const f of data.files ?? []) if (f.key.startsWith(data.tenant.id + "/")) await restoreFile(f.key, Buffer.from(f.data, "base64"), f.contentType);
}

/** Replaces the pharmacy's live rows with the test copy, in one transaction. */
export async function swapIn(ctx: Pick<Ctx, "tenantId" | "userName"> & { userId: string | null }, schema: string, tenant: RestoreData["tenant"], detail: string) {
  const L = await layout();
  await db.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL medoro.restore = 'on'`);
    for (const t of L.clear) await tx.$executeRawUnsafe(`DELETE FROM public.${q(t.name)} WHERE ${scope("public", t)}`, ctx.tenantId);
    for (const t of [...L.tables].reverse()) await tx.$executeRawUnsafe(`DELETE FROM public.${q(t.name)} WHERE ${scope("public", t)}`, ctx.tenantId);
    for (const t of L.tables) await tx.$executeRawUnsafe(`INSERT INTO public.${q(t.name)} SELECT * FROM ${q(schema)}.${q(t.name)}`);
    // Restored rows keep their ids; move id sequences past them (on a new server they start at 1).
    for (const s of await tx.$queryRaw<{ t: string; c: string; seq: string }[]>`SELECT table_name t, column_name c, pg_get_serial_sequence(format('public.%I', table_name), column_name) seq FROM information_schema.columns WHERE table_schema = 'public' AND column_default LIKE 'nextval(%'`) {
      if (!s.seq || !L.tables.some((x) => x.name === s.t)) continue;
      const [v] = await tx.$queryRawUnsafe<{ hi: bigint | null; last: bigint }[]>(`SELECT (SELECT max(${q(s.c)}) FROM public.${q(s.t)}) hi, (SELECT last_value FROM ${s.seq}) last`);
      if (v.hi !== null && v.hi > v.last) await tx.$executeRawUnsafe(`SELECT setval('${s.seq.replace(/'/g, "''")}', ${v.hi})`);
    }
    const live = await tx.tenant.findUniqueOrThrow({ where: { id: ctx.tenantId } });
    const keepBackup = (live.settings as { backup?: unknown }).backup;
    await tx.tenant.update({ where: { id: ctx.tenantId }, data: { name: tenant.name, legalName: tenant.legalName, gstin: tenant.gstin, phone: tenant.phone, settings: { ...((tenant.settings as object) ?? {}), ...(keepBackup ? { backup: keepBackup } : {}) } as object } });
    await writeAudit(tx, { tenantId: ctx.tenantId, branchId: null, userId: ctx.userId, userName: ctx.userName, action: "Backup restored", entity: "backup", detail });
  }, { timeout: 300_000, maxWait: 20_000 });
}

