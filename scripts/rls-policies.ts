/**
 * Prints the SQL that would confine a non-owner application role to one tenant per transaction. READ-ONLY: it connects, reads the
 * catalogue and prints; it applies nothing. Review the output, run it in staging first, and follow docs/MEDORO_2.md section 5.
 *
 *   DATABASE_URL=… npx tsx scripts/rls-policies.ts [role]  > rls.sql        (role defaults to medoro_app)
 */
import { PrismaClient } from "@prisma/client";
import { policySql, readCatalog, roleSql } from "../src/server/rls";

const role = process.argv[2] ?? "medoro_app";

async function main() {
  const db = new PrismaClient();
  try {
    const cat = await readCatalog(db);
    console.log(`-- Generated ${new Date().toISOString()}. Tenant tables: ${cat.tenantTables.length}; child tables via parent: ${cat.children.length}; NOT covered: ${cat.uncovered.length}.`);
    console.log(`-- NOT covered by tenant policies (platform data or tenants themselves; the application role must be kept away from them another way):\n-- ${cat.uncovered.join(", ")}\n`);
    console.log(roleSql(role).join("\n"), "\n");
    console.log("BEGIN;\n" + policySql(cat, { role }).join("\n") + "\nCOMMIT;");
  } finally { await db.$disconnect(); }
}
main().catch((e) => { console.error(e); process.exit(1); });
