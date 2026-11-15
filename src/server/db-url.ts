/**
 * DATABASE_URL with `connection_limit` taken from DB_CONNECTION_LIMIT when that is set, so the pool size can be
 * changed without re-entering the (secret) connection string. With one connection per server, every request on that
 * server waited in line behind the others' queries.
 */
export function withConnectionLimit(url: string | undefined, limit: string | undefined): string | undefined {
  const n = Number(limit);
  if (!url || !limit || !Number.isInteger(n) || n < 1) return url;
  if (/[?&]connection_limit=[^&]*/.test(url)) return url.replace(/([?&]connection_limit=)[^&]*/, `$1${n}`);
  return url + (url.includes("?") ? "&" : "?") + `connection_limit=${n}`;
}
