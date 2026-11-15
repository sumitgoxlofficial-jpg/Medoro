import { PrismaClient } from "@prisma/client";
import { withConnectionLimit } from "./db-url";

const g = globalThis as unknown as { prisma?: PrismaClient };
const url = withConnectionLimit(process.env.DATABASE_URL, process.env.DB_CONNECTION_LIMIT);
export const db = g.prisma ?? new PrismaClient(url && url !== process.env.DATABASE_URL ? { datasources: { db: { url } } } : undefined);
if (process.env.NODE_ENV !== "production") g.prisma = db;

export type Tx = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];
export type DbOrTx = PrismaClient | Tx;
