// DriveDB Phase 0 speed test. Runs entirely on this device: builds a sample pharmacy database in
// the browser's private storage (OPFS), times common work, then optionally times an encrypted
// upload/download of that database to the owner's Google Drive. Nothing is sent to Medoro's server.
import sqlite3InitModule from "./sqlite/index.mjs";

const DRIVE = "https://www.googleapis.com/drive/v3/files";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3/files";
const DB_FILE = "/medoro-speed-test.db";

const post = (type, data) => self.postMessage({ type, ...data });
const log = (step, ms, note = "") => post("row", { step, ms: Math.round(ms), note });
const now = () => performance.now();
async function timed(step, fn, note) {
  const t = now();
  const r = await fn();
  log(step, now() - t, typeof note === "function" ? note(r) : note ?? "");
  return r;
}

// Small deterministic random generator so every device gets the same data.
let seed = 42;
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const pick = (a) => a[Math.floor(rnd() * a.length)];
const PARTS = ["para", "amox", "azi", "cefi", "dolo", "pan", "rab", "met", "glim", "telmi", "amlo", "ator", "rosu", "levo", "cetri", "mont", "vita", "calci", "ome", "dom"];
const ENDS = ["cip", "cin", "mol", "zole", "pril", "sartan", "statin", "mycin", "xime", "fen", "dine", "lukast", "plex", "D3", "flox"];
const FORMS = ["Tab", "Cap", "Syp", "Inj", "Cream", "Drops"];

const SCHEMA = `
CREATE TABLE medicine (id INTEGER PRIMARY KEY, name TEXT NOT NULL, form TEXT, hsn TEXT, gst INTEGER, mrp INTEGER);
CREATE INDEX medicine_name ON medicine(name COLLATE NOCASE);
CREATE TABLE batch (id INTEGER PRIMARY KEY, medicine_id INTEGER NOT NULL, batch_no TEXT, expiry TEXT, mrp INTEGER, cost INTEGER);
CREATE INDEX batch_med ON batch(medicine_id);
CREATE TABLE sale (id INTEGER PRIMARY KEY, invoice_no TEXT UNIQUE, at TEXT, customer TEXT, total INTEGER);
CREATE INDEX sale_at ON sale(at);
CREATE TABLE sale_item (id INTEGER PRIMARY KEY, sale_id INTEGER, batch_id INTEGER, qty INTEGER, price INTEGER);
CREATE INDEX sale_item_sale ON sale_item(sale_id);
CREATE TABLE stock_movement (id INTEGER PRIMARY KEY, batch_id INTEGER, qty INTEGER, kind TEXT, at TEXT);
CREATE INDEX movement_batch ON stock_movement(batch_id);
CREATE TABLE change_log (id INTEGER PRIMARY KEY, clock TEXT, tbl TEXT, row_id INTEGER, op TEXT, data TEXT);
`;

let sqlite3, pool, db;

async function openDb() {
  sqlite3 = await timed("Load SQLite engine", () => sqlite3InitModule());
  try {
    pool = await timed("Open private storage (OPFS)", () => sqlite3.installOpfsSAHPoolVfs({ name: "medoro-speed-test" }), "available");
    try { pool.unlink(DB_FILE); } catch {}
    db = new pool.OpfsSAHPoolDb(DB_FILE);
    post("info", { key: "Storage", value: "OPFS (saved on device)" });
  } catch (e) {
    log("Open private storage (OPFS)", 0, `NOT available: ${e?.message ?? e} — using memory only`);
    db = new sqlite3.oo1.DB(":memory:");
    post("info", { key: "Storage", value: "Memory only (OPFS not available)" });
  }
  db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;");
}

function insertMany(sql, n, row) {
  const st = db.prepare(sql);
  try {
    db.transaction(() => { for (let i = 1; i <= n; i++) st.bind(row(i)).stepReset(); });
  } finally { st.finalize(); }
}

const day = (i) => new Date(Date.UTC(2026, 0, 1) + (i % 365) * 864e5).toISOString().slice(0, 10);

async function build(size) {
  const meds = size.medicines, batches = meds * 2, sales = size.sales, lines = size.lines;
  db.exec(SCHEMA);
  await timed(`Add ${meds.toLocaleString("en-IN")} medicines`, () =>
    insertMany("INSERT INTO medicine VALUES (?,?,?,?,?,?)", meds, (i) => [i, `${pick(PARTS)}${pick(ENDS)} ${[250, 500, 650, 40, 10][i % 5]} ${pick(FORMS)} ${i}`, pick(FORMS), "3004", pick([5, 12, 18]), 1000 + Math.floor(rnd() * 50000)]));
  await timed(`Add ${batches.toLocaleString("en-IN")} batches + opening stock`, () => {
    insertMany("INSERT INTO batch VALUES (?,?,?,?,?,?)", batches, (i) => [i, ((i - 1) % meds) + 1, `B${i}`, `2027-${String((i % 12) + 1).padStart(2, "0")}-01`, 1000 + (i % 50000), 800 + (i % 40000)]);
    insertMany("INSERT INTO stock_movement (batch_id, qty, kind, at) VALUES (?,?,?,?)", batches, (i) => [i, 100 + (i % 200), "opening", day(0)]);
  });
  const per = Math.max(1, Math.round(lines / sales));
  await timed(`Add ${sales.toLocaleString("en-IN")} past bills (${lines.toLocaleString("en-IN")} lines)`, () => {
    const s = db.prepare("INSERT INTO sale VALUES (?,?,?,?,?)");
    const it = db.prepare("INSERT INTO sale_item (sale_id, batch_id, qty, price) VALUES (?,?,?,?)");
    const mv = db.prepare("INSERT INTO stock_movement (batch_id, qty, kind, at) VALUES (?,?,?,?)");
    try {
      db.transaction(() => {
        for (let i = 1; i <= sales; i++) {
          let total = 0;
          for (let j = 0; j < per; j++) {
            const b = 1 + Math.floor(rnd() * batches), q = 1 + (j % 3), p = 1000 + (b % 50000);
            total += q * p;
            it.bind([i, b, q, p]).stepReset();
            mv.bind([b, -q, "sale", day(i)]).stepReset();
          }
          s.bind([i, `C1-${i}`, day(i), i % 4 ? null : `Customer ${i % 997}`, total]).stepReset();
        }
      });
    } finally { s.finalize(); it.finalize(); mv.finalize(); }
  });
}

function avg(step, runs, fn, note) {
  const t = now();
  let r;
  for (let i = 0; i < runs; i++) r = fn(i);
  log(step, (now() - t) / runs, `average of ${runs}${note ? ` · ${note(r)}` : ""}`);
}

function work(size) {
  const terms = ["para", "amox", "dolo", "pan", "met", "cetri", "vita", "ator"];
  avg("Search medicine by first letters", 50, (i) =>
    db.selectArrays("SELECT id, name FROM medicine WHERE name LIKE ? ORDER BY name LIMIT 20", [`${terms[i % terms.length]}%`]).length, (n) => `${n} results`);
  avg("Search medicine by any part of name", 20, (i) =>
    db.selectArrays("SELECT id, name FROM medicine WHERE name LIKE ? LIMIT 20", [`%${ENDS[i % ENDS.length]}%`]).length, (n) => `${n} results`);
  avg("Stock of one medicine (all batches)", 100, (i) =>
    db.selectValue("SELECT COALESCE(SUM(m.qty),0) FROM batch b JOIN stock_movement m ON m.batch_id=b.id WHERE b.medicine_id=?", [1 + ((i * 7919) % size.medicines)]));
  let next = size.sales + 1;
  const batches = size.medicines * 2;
  avg("Save one bill (5 lines, stock, change log)", 100, () => {
    db.transaction(() => {
      const id = next++;
      let total = 0;
      for (let j = 0; j < 5; j++) {
        const b = 1 + Math.floor(rnd() * batches), q = 1 + j, p = 1000 + (b % 50000);
        total += q * p;
        db.exec({ sql: "INSERT INTO sale_item (sale_id, batch_id, qty, price) VALUES (?,?,?,?)", bind: [id, b, q, p] });
        db.exec({ sql: "INSERT INTO stock_movement (batch_id, qty, kind, at) VALUES (?,?,?,?)", bind: [b, -q, "sale", day(id)] });
      }
      db.exec({ sql: "INSERT INTO sale VALUES (?,?,?,?,?)", bind: [id, `C1-${id}`, day(id), null, total] });
      db.exec({ sql: "INSERT INTO change_log (clock, tbl, row_id, op, data) VALUES (?,?,?,?,?)", bind: [`${Date.now()}-0-dev`, "sale", id, "insert", JSON.stringify({ total })] });
    });
  });
  avg("One day's sales total", 20, (i) => db.selectValue("SELECT SUM(total) FROM sale WHERE at=?", [day(i + 1)]));
  avg("Full stock report (every batch)", 3, () => db.selectArrays("SELECT batch_id, SUM(qty) FROM stock_movement GROUP BY batch_id").length, (n) => `${n.toLocaleString("en-IN")} batches`);
  avg("Monthly sales report (12 months)", 3, () => db.selectArrays("SELECT substr(at,1,7) m, COUNT(*), SUM(total) FROM sale GROUP BY m").length);
}

// ---------- Google Drive ----------
async function encrypt(bytes) {
  const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const enc = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, bytes));
  return { key, iv, enc };
}

async function driveFetch(token, url, init = {}) {
  const r = await fetch(url, { ...init, headers: { ...(init.headers ?? {}), Authorization: `Bearer ${token}` } });
  if (!r.ok && r.status !== 404) throw new Error(`Drive ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return r;
}

async function upload(token, name, bytes) {
  const start = await driveFetch(token, `${UPLOAD}?uploadType=resumable&fields=id`, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=UTF-8", "X-Upload-Content-Type": "application/octet-stream", "X-Upload-Content-Length": String(bytes.length) },
    body: JSON.stringify({ name, appProperties: { medoroSpeedTest: "1" } }),
  });
  const loc = start.headers.get("Location");
  if (!loc) throw new Error("Drive did not return an upload address");
  const r = await driveFetch(token, loc, { method: "PUT", headers: { "Content-Type": "application/octet-stream" }, body: bytes });
  return (await r.json()).id;
}

async function drive(token) {
  const mb = (n) => (n / 1048576).toFixed(1);
  const raw = await timed("Export database to one file", () => sqlite3.capi.sqlite3_js_db_export(db), (b) => `${mb(b.length)} MB`);
  const { key, iv, enc } = await timed("Encrypt (AES-256)", () => encrypt(raw));
  let id;
  const t = now();
  id = await upload(token, "Medoro speed test (safe to delete).bin", enc);
  const up = now() - t;
  log("Upload snapshot to Google Drive", up, `${mb(enc.length)} MB · ${(enc.length / 1048576 / (up / 1000)).toFixed(2)} MB/s`);
  try {
    const t2 = now();
    const back = new Uint8Array(await (await driveFetch(token, `${DRIVE}/${id}?alt=media`)).arrayBuffer());
    const down = now() - t2;
    log("Download snapshot from Google Drive", down, `${(back.length / 1048576 / (down / 1000)).toFixed(2)} MB/s`);
    const plain = await timed("Decrypt", async () => new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, back)));
    log("Check downloaded copy", 0, plain.length === raw.length && plain.every((v, i) => v === raw[i]) ? "identical ✓" : "MISMATCH ✗");
  } finally {
    await driveFetch(token, `${DRIVE}/${id}`, { method: "DELETE" }).catch(() => {});
  }
  // A change-log file is a few KB: this is what each bill sync costs.
  const small = crypto.getRandomValues(new Uint8Array(4096));
  const ids = [];
  const t3 = now();
  for (let i = 0; i < 5; i++) ids.push(await upload(token, `Medoro speed test log ${i} (safe to delete).bin`, small));
  log("Upload one small change-log file", (now() - t3) / 5, "average of 5 · 4 KB each");
  await Promise.all(ids.map((x) => driveFetch(token, `${DRIVE}/${x}`, { method: "DELETE" }).catch(() => {})));
  log("Test files removed from Drive", 0, "");
}

async function deviceInfo() {
  post("info", { key: "Browser", value: navigator.userAgent });
  post("info", { key: "CPU cores", value: String(navigator.hardwareConcurrency ?? "?") });
  if (navigator.deviceMemory) post("info", { key: "Memory", value: `${navigator.deviceMemory} GB (approx.)` });
  const est = await navigator.storage?.estimate?.().catch(() => null);
  if (est?.quota) post("info", { key: "Free browser storage", value: `${(est.quota / 1073741824).toFixed(1)} GB` });
}

// A dedicated worker only receives messages from the page that created it (same origin), so there is no
// sender origin to check; we still accept only the expected shape and sane sizes.
const okSize = (n) => Number.isInteger(n) && n > 0 && n <= 500_000;
self.onmessage = async ({ data }) => {
  const s = data?.size;
  if (!s || !okSize(s.medicines) || !okSize(s.sales) || !okSize(s.lines) || (data.token != null && typeof data.token !== "string")) return;
  const total = now();
  try {
    await deviceInfo();
    await openDb();
    await build(data.size);
    work(data.size);
    if (data.token) await drive(data.token);
    else log("Google Drive test", 0, data.driveNote ?? "skipped");
    log("Total time", now() - total);
    post("done", {});
  } catch (e) {
    post("error", { message: String(e?.message ?? e) });
  } finally {
    try { db?.close(); pool?.unlink(DB_FILE); } catch {}
  }
};
