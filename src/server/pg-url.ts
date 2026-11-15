/**
 * Connection string for the `pg` driver (live updates, startup check). pg 8 treats `sslmode=require` as
 * `verify-full`, which rejects Supabase's pooler certificate ("self-signed certificate in certificate chain"),
 * so live updates never connected and every open screen reconnected every few seconds. `uselibpqcompat=true`
 * gives `require` its standard libpq meaning (encrypted, as Prisma does), and leaves verify-ca/verify-full as asked.
 */
export function pgConnectionString(url: string | undefined): string | undefined {
  if (!url) return url;
  const m = /[?&]sslmode=([^&]+)/.exec(url);
  if (!m || /[?&]uselibpqcompat=/.test(url) || !["require", "prefer"].includes(m[1])) return url;
  return url + "&uselibpqcompat=true";
}
