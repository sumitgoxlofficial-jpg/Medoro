import { api } from "@/server/api";
import { disconnectConnection } from "@/domain/finance/connections";

export const dynamic = "force-dynamic";
/** Disconnects: revokes at the provider, deletes the stored credentials, keeps the history. */
export const DELETE = api<{ id: string }>(async (ctx, _req, { id }) => disconnectConnection(ctx, id));
