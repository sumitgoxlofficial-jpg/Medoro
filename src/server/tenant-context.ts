import type { PrismaClient } from "@prisma/client";

/**
 * Runs `fn` in a transaction whose first statement sets the tenant for row-level security (see rls.ts). `set_config(…, true)` is
 * transaction-local, so the setting disappears when the transaction ends and can never leak to the next user of a pooled connection.
 * Not used by the application yet: it is the tested building block for the staged RLS rollout.
 */
type TxClient = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function withTenant<T>(client: Pick<PrismaClient, "$transaction">, tenantId: string, fn: (tx: TxClient) => Promise<T>): Promise<T> {
  if (!UUID.test(tenantId)) throw new Error("withTenant needs a valid tenant id.");
  return client.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
    return fn(tx);
  });
}
