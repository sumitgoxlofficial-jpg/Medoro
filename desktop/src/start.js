// Start page: remembers the server address, tells the app which server it may open, and opens it.
// ?change=1 (menu "Change server…") waits for a new address; ?unreachable=1 means the server
// stopped answering, so offer retry, a different server, or offline billing.
const KEY = "medoro.server";
const $ = (id) => document.getElementById(id);
const q = new URLSearchParams(location.search);
const mac = /Mac OS X|Macintosh/.test(navigator.userAgent);
const clean = (v) => {
  let s = v.trim();
  if (!/^https?:\/\//i.test(s)) s = "https://" + s;
  const u = new URL(s);
  return u.origin;
};
async function allow(origin) {
  const t = window.__TAURI__;
  if (t) await t.core.invoke("set_server", { origin });
}
async function reachable(origin) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), 6000);
  try { await fetch(origin + "/manifest.webmanifest", { mode: "no-cors", cache: "no-store", signal: c.signal }); return true; }
  catch { return false; }
  finally { clearTimeout(t); }
}
function fail(origin, text) {
  const btn = document.querySelector("button.primary");
  btn.disabled = false; btn.textContent = "Try again";
  $("err").textContent = text;
  $("err").hidden = false;
  $("change").hidden = false;
  if (!mac && localStorage.getItem(KEY) === origin) {
    $("off").hidden = false;
    $("off").onclick = async () => { await allow(origin); location.replace(origin + "/offline"); };
  }
}
async function go(origin, auto) {
  const btn = document.querySelector("button.primary");
  btn.disabled = true; btn.textContent = "Connecting…"; $("err").hidden = true;
  if (await reachable(origin)) {
    try { await allow(origin); } catch (e) { return fail(origin, String(e)); }
    localStorage.setItem(KEY, origin); location.replace(origin + "/app"); return;
  }
  fail(origin, auto
    ? `Can’t reach ${origin}. Check the network, then try again${mac ? "" : ", or keep billing offline if this counter has it turned on"}.`
    : `Can’t reach ${origin}. Check the address and that this computer is on the pharmacy network.`);
}
let auto = null;
const stopAuto = (lead) => { if (auto) { clearTimeout(auto); auto = null; } $("lead").textContent = lead; };
const saved = localStorage.getItem(KEY);
if (saved) $("url").value = saved;
if (mac) $("mac").hidden = false;
$("f").addEventListener("submit", (e) => {
  e.preventDefault();
  try { go(clean($("url").value), false); } catch { $("err").textContent = "That doesn’t look like a web address."; $("err").hidden = false; }
});
$("change").addEventListener("click", () => { stopAuto("Change the server address, then press Connect."); $("url").focus(); $("url").select(); });
$("url").addEventListener("focus", () => { if (auto) stopAuto("Change the server address, then press Connect."); });
if (saved && q.has("unreachable")) {
  $("lead").textContent = "Lost connection to your Medoro server.";
  fail(saved, `Can’t reach ${saved}. Check the network, then try again${mac ? "" : ", or keep billing offline if this counter has it turned on"}.`);
} else if (q.has("change")) {
  stopAuto("Change the server address, then press Connect.");
  $("change").hidden = true;
  $("url").focus(); $("url").select();
} else if (saved) {
  $("lead").textContent = "Connecting to your Medoro server…";
  // Give a moment to change the server before connecting automatically.
  auto = setTimeout(() => { auto = null; go(saved, true); }, 1200);
}
