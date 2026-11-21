/**
 * A full page load to a path on this site, on purpose: for API routes that redirect elsewhere or send a file (Google
 * connect, report downloads), which the Next.js router can't render, and for moments that must drop all client state
 * (after a restore, on sign-out). For moving between pages, use the router instead.
 */
export function hardNavigate(path: string) {
  window.location.assign(new URL(path, window.location.origin).href);
}
