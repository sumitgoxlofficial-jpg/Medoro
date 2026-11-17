/**
 * Row-level-security readiness kit. NOTHING here is enabled in production: it is the tested machinery for the staged plan in
 * docs/MEDORO_2.md section 5. It generates tenant-isolation policies from the live catalogue, so a table added later is covered
 * and one that can't be covered is reported rather than silently skipped.
 *
 * Model: the application connects as a NON-owner role; each request's queries run in a transaction that first sets
 * `app.tenant_id` (see tenant-context.ts); policies compare a row's tenant with that setting. With no tenant set the setting is
 * empty and every comparison fails, so the default is to return nothing.
 *   - tables with a "tenantId" column: the row's own tenant must match;
 *   - child tables without one (SaleItem, Payment, LedgerLine, GrnItem, …): the parent row they point at (single-column foreign
 *     key to a tenant table) must be visible, which applies the parent's policy in turn.
 *   - everything else (platform data: staff, HR, growth, catalogue, rate limits, tenants themselves) is NOT covered and is listed.
 */
export type ChildLink = { child: string; fkCol: string; parent: string; parentCol: string };
export type Catalog = { tenantTables: string[]; children: ChildLink[]; uncovered: string[] };
type Q = { $queryRawUnsafe: <T = unknown>(sql: string, ...v: unknown[]) => Promise<T> };

const ident = (s: string) => `"${s.replace(/"/g, '""')}"`;

/** Reads which tables are tenant-owned, directly or through a parent, and which are neither. */
export async function readCatalog(db: Q): Promise<Catalog> {
  const direct = (await db.$queryRawUnsafe<{ t: string }[]>(
    `SELECT c.table_name AS t FROM information_schema.columns c JOIN information_schema.tables t ON t.table_name = c.table_name AND t.table_schema = c.table_schema
     WHERE c.table_schema = 'public' AND c.column_name = 'tenantId' AND t.table_type = 'BASE TABLE' ORDER BY 1`)).map((r) => r.t);
  const all = (await db.$queryRawUnsafe<{ t: string }[]>(`SELECT c.relname AS t FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname <> '_prisma_migrations' ORDER BY 1`)).map((r) => r.t);
  const fks = await db.$queryRawUnsafe<ChildLink[]>(
    `SELECT cl.relname AS child, a.attname AS "fkCol", fl.relname AS parent, af.attname AS "parentCol"
     FROM pg_constraint k JOIN pg_class cl ON cl.oid = k.conrelid JOIN pg_class fl ON fl.oid = k.confrelid JOIN pg_namespace n ON n.oid = cl.relnamespace
     JOIN pg_attribute a ON a.attrelid = k.conrelid AND a.attnum = k.conkey[1] JOIN pg_attribute af ON af.attrelid = k.confrelid AND af.attnum = k.confkey[1]
     WHERE k.contype = 'f' AND n.nspname = 'public' AND array_length(k.conkey, 1) = 1 ORDER BY 1, 2`);
  const set = new Set(direct), children: ChildLink[] = [];
  for (const f of fks) if (!set.has(f.child) && set.has(f.parent) && !children.some((c) => c.child === f.child)) children.push(f);
  const covered = new Set([...direct, ...children.map((c) => c.child)]);
  return { tenantTables: direct, children, uncovered: all.filter((t) => !covered.has(t)) };
}

export type PolicyOptions = { role: string; policyName?: string };
const TENANT = `NULLIF(current_setting('app.tenant_id', true), '')`;

/** The statements that confine `role` to one tenant per transaction. Idempotent where PostgreSQL allows (drops before create). */
export function policySql(cat: Pick<Catalog, "tenantTables" | "children">, o: PolicyOptions): string[] {
  const name = ident(o.policyName ?? "medoro_tenant_isolation"), role = ident(o.role), out: string[] = [];
  const enable = (t: string) => { out.push(`ALTER TABLE ${ident(t)} ENABLE ROW LEVEL SECURITY;`, `ALTER TABLE ${ident(t)} FORCE ROW LEVEL SECURITY;`, `DROP POLICY IF EXISTS ${name} ON ${ident(t)};`); };
  for (const t of cat.tenantTables) {
    enable(t);
    out.push(`CREATE POLICY ${name} ON ${ident(t)} AS PERMISSIVE FOR ALL TO ${role} USING (${ident("tenantId")} = ${TENANT}) WITH CHECK (${ident("tenantId")} = ${TENANT});`);
  }
  for (const c of cat.children) {
    enable(c.child);
    const exists = `EXISTS (SELECT 1 FROM ${ident(c.parent)} p WHERE p.${ident(c.parentCol)} = ${ident(c.child)}.${ident(c.fkCol)})`;
    out.push(`CREATE POLICY ${name} ON ${ident(c.child)} AS PERMISSIVE FOR ALL TO ${role} USING (${exists}) WITH CHECK (${exists});`);
  }
  return out;
}

/** Statements to undo policySql (used by tests and for rollback). */
export function rollbackSql(cat: Pick<Catalog, "tenantTables" | "children">, o: PolicyOptions): string[] {
  const name = ident(o.policyName ?? "medoro_tenant_isolation");
  return [...cat.tenantTables, ...cat.children.map((c) => c.child)].flatMap((t) => [`DROP POLICY IF EXISTS ${name} ON ${ident(t)};`, `ALTER TABLE ${ident(t)} NO FORCE ROW LEVEL SECURITY;`]);
}

/** A starting point for the non-owner role. Review before use: it grants data access only, no DDL, no BYPASSRLS. */
export const roleSql = (role: string) => [
  `-- CREATE ROLE ${ident(role)} LOGIN PASSWORD '…' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;   -- set the password out of band`,
  `GRANT USAGE ON SCHEMA public TO ${ident(role)};`,
  `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${ident(role)};`,
  `GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${ident(role)};`,
  `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${ident(role)};`,
];
