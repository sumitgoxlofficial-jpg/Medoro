// Pure formatting helpers, usable from server and client components alike.
export const fmtDT = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" }) : "—");
export const fmtD = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" }) : "—");
/** datetime-local value → ISO with the browser's offset (IST for Indian users). */
export const localToIso = (v: string) => (v ? new Date(v).toISOString() : "");
