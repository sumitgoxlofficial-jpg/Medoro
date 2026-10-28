// Start page: remembers the server address and opens it. If the server can't be reached, offers
// offline billing, which the server's service worker keeps on this computer once it's turned on.
const KEY = "medoro.server";
const $ = (id) => document.getElementById(id);
const clean = (v) => {
  let s = v.trim();
  if (!/^https?:\/\//i.test(s)) s = "https://" + s;
  const u = new URL(s);
  return u.origin;
};
async function reachable(origin) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), 6000);
  try { await fetch(origin + "/manifest.webmanifest", { mode: "no-cors", cache: "no-store", signal: c.signal }); return true; }
  catch { return false; }
  finally { clearTimeout(t); }
}
async function go(origin, auto) {
  const btn = document.querySelector("button.primary");
  btn.disabled = true; btn.textContent = "Connecting…"; $("err").hidden = true;
  if (await reachable(origin)) { localStorage.setItem(KEY, origin); location.replace(origin + "/app"); return; }
  btn.disabled = false; btn.textContent = "Try again";
  $("err").textContent = auto ? `Can’t reach ${origin}. Check the network, or keep billing offline if this counter has it turned on.` : `Can’t reach ${origin}. Check the address and that this computer is on the pharmacy network.`;
  $("err").hidden = false;
  if (localStorage.getItem(KEY) === origin) { $("off").hidden = false; $("off").onclick = () => location.replace(origin + "/offline"); }
}
const saved = localStorage.getItem(KEY);
if (saved) { $("url").value = saved; $("lead").textContent = "Connecting to your Medoro server…"; }
$("f").addEventListener("submit", (e) => {
  e.preventDefault();
  try { go(clean($("url").value), false); } catch { $("err").textContent = "That doesn’t look like a web address."; $("err").hidden = false; }
});
// Give a moment to change the server before connecting automatically.
let auto = saved ? setTimeout(() => go(saved, true), 1200) : null;
$("url").addEventListener("focus", () => { if (auto) { clearTimeout(auto); auto = null; $("lead").textContent = "Change the server address, then press Connect."; } });
