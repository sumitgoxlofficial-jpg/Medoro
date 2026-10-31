export const DEPLOYMENTS = ["cloud", "onprem", "lan", "hosted"] as const;
export type Deployment = (typeof DEPLOYMENTS)[number];

const MANAGED = /(\.supabase\.(co|com)|\.pooler\.supabase\.com|\.neon\.tech|\.rds\.amazonaws\.com|\.postgres\.database\.azure\.com|\.aivencloud\.com|\.render\.com|\.railway\.app)$/i;
const LOCAL = /^(localhost|127\.\d+\.\d+\.\d+|::1|\[::1\]|postgres|db)$/i;

/** Where DATABASE_URL actually points: "local" (same machine/compose), "managed" (known DBaaS) or "other". */
export function databaseKind(url: string | undefined): "local" | "managed" | "other" | "unknown" {
  if (!url) return "unknown";
  try {
    const host = new URL(url).hostname;
    if (LOCAL.test(host)) return "local";
    if (MANAGED.test(host)) return "managed";
    return "other";
  } catch {
    return "unknown";
  }
}

/** The recorded deployment must agree with the database this server is really connected to. */
export function deploymentMismatch(choice: Deployment, url: string | undefined): string | null {
  const kind = databaseKind(url);
  if (choice === "hosted" && kind === "local") return "This server’s database (DATABASE_URL) is on this machine, not a hosted service. Choose where this server runs instead.";
  if (choice !== "hosted" && kind === "managed") return "This server’s database (DATABASE_URL) is a hosted PostgreSQL service. Choose “Hosted PostgreSQL”.";
  return null;
}

/** The deployment recorded for a self sign-up: the server's own, consistent with its database. */
export function signupDeployment(mode: string | undefined, url: string | undefined): Deployment {
  const kind = databaseKind(url);
  if (kind === "managed") return "hosted";
  const m = DEPLOYMENTS.find((d) => d === mode);
  return m && m !== "hosted" ? m : "cloud";
}
