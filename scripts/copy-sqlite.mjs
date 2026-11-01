// Copies the browser SQLite build into public/drivedb/sqlite so the DriveDB worker can load it as a plain file.
import { cpSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
let src;
try { src = join(dirname(require.resolve("@sqlite.org/sqlite-wasm/package.json")), "dist"); } catch { process.exit(0); }
if (!existsSync(src)) process.exit(0);
const out = join(process.cwd(), "public", "drivedb", "sqlite");
mkdirSync(out, { recursive: true });
for (const f of ["index.mjs", "sqlite3.wasm", "sqlite3-opfs-async-proxy.js"]) cpSync(join(src, f), join(out, f));
