import { db } from "@/server/db";
import { createPharmacy } from "@/domain/identity/service";

/** Empties every table. Append-only triggers are row-level, so TRUNCATE still works. */
export async function resetDb() {
  const tables = await db.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'`;
  await db.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(", ")} RESTART IDENTITY CASCADE`);
}

export const KEY = "A".repeat(43);

export async function makePharmacy(over: Partial<Parameters<typeof createPharmacy>[0]> = {}) {
  return createPharmacy({
    pharmacy: { name: "Test Medical Store", code: "TEST-PUNE", gstin: "27AAKFS3192P1Z6", dl: "MH-1234", pharmacist: "", address: "Pune", lang: "en" },
    owner: { name: "Owner Person", email: "owner@test.in", phone: "9822000001", password: "long-enough-pw" },
    deployment: "lan",
    branches: [{ name: "Main", counters: 2 }, { name: "Second", counters: 1 }],
    invites: [{ contact: "9850000002", role: "Cashier" }],
    backupKey: KEY, kitAck: true,
    ...over,
  });
}
