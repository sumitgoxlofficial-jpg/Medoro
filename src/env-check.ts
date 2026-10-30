// Fails fast in production when required settings are missing or weak. Names only, never values.
export function checkEnv(env: NodeJS.ProcessEnv = process.env): string[] {
  const problems: string[] = [];
  const need = (k: string, why: string) => { if (!env[k]) problems.push(`${k} is not set (${why}).`); };
  need("DATABASE_URL", "PostgreSQL connection");
  if ((env.SESSION_SECRET ?? "").length < 32) problems.push("SESSION_SECRET must be at least 32 characters.");
  if ((env.HOST_KEY ?? "").length < 32) problems.push(`HOST_KEY must be at least 32 characters (seals integration secrets and backup keys).${env.HOST_KEY ? " Upgrading from a shorter key? Move it to HOST_KEY_PREVIOUS and set a new HOST_KEY (docs/DEPLOYMENT.md)." : ""}`);
  else if (env.HOST_KEY === env.SESSION_SECRET) problems.push("HOST_KEY must differ from SESSION_SECRET, so rotating sessions doesn't lock stored secrets.");
  else if (env.HOST_KEY === env.HOST_KEY_PREVIOUS) problems.push("HOST_KEY_PREVIOUS is the old key and must differ from HOST_KEY.");
  if (env.VERCEL) {
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
