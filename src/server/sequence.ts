import type { Tx } from "./db";

/** Take the next number for a key. Row lock (via upsert + UPDATE … RETURNING) keeps it gap-free per transaction. */
export async function nextSeq(tx: Tx, tenantId: string, key: string): Promise<number> {
  const rows = await tx.$queryRaw<{ next: number }[]>`
    INSERT INTO "Sequence" ("tenantId", "key", "next") VALUES (${tenantId}, ${key}, 2)
    ON CONFLICT ("tenantId", "key") DO UPDATE SET "next" = "Sequence"."next" + 1
    RETURNING "next" - 1 AS next`;
  return Number(rows[0].next);
}

export const pad = (n: number, w = 4) => String(n).padStart(w, "0");
