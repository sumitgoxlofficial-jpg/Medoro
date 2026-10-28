// Fails fast in production when required settings are missing or weak. Names only, never values.
export function checkEnv(env: NodeJS.ProcessEnv = process.env): string[] {
  const problems: string[] = [];
  const need = (k: string, why: string) => { if (!env[k]) problems.push(`${k} is not set (${why}).`); };
  need("DATABASE_URL", "PostgreSQL connection");
  if ((env.SESSION_SECRET ?? "").length < 32) problems.push("SESSION_SECRET must be at least 32 characters.");
  if (env.VERCEL) {
    if ((env.HOST_KEY ?? "").length < 32) problems.push("HOST_KEY must be at least 32 characters (seals integration secrets and backup keys).");
    need("APP_URL", "public address used in links and webhooks");
    need("DIRECT_URL", "session-mode database URL for migrations and live updates");
    if (!!env.SUPABASE_URL !== !!env.SUPABASE_SECRET_KEY) problems.push("Set both SUPABASE_URL and SUPABASE_SECRET_KEY for bucket storage, or neither (files are then kept in the database).");
    if ((env.CRON_SECRET ?? "").length < 16) problems.push("CRON_SECRET must be at least 16 characters (daily backups).");
  }
  for (const k of Object.keys(env)) {
    if (k.startsWith("NEXT_PUBLIC_") && /SECRET|KEY|TOKEN|PASSWORD/.test(k) && k !== "NEXT_PUBLIC_SW") problems.push(`${k} looks like a secret but NEXT_PUBLIC_ variables are sent to browsers. Rename it.`);
  }
  return problems;
}
