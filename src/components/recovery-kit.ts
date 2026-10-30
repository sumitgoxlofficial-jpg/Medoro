"use client";
import { qrSvg } from "@/lib/qr";

export type Kit = { pharmacy: string; code: string; key: string; fingerprint: string; created?: Date };

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** A self-contained printable page: the backup key as text and as a QR code. No scripts, no external files. */
export function recoveryKitHtml(k: Kit) {
  const created = (k.created ?? new Date()).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" });
  const groups = k.key.match(/.{1,4}/g)?.join(" ") ?? k.key;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Medoro recovery kit · ${esc(k.code)}</title>
<style>@page{size:A4;margin:16mm}body{font-family:system-ui,-apple-system,"Segoe UI",sans-serif;color:#111;max-width:720px;margin:24px auto;padding:0 16px;line-height:1.5}
h1{font-size:22px;margin:0 0 4px}.sub{color:#555;margin:0 0 20px}.box{border:2px solid #0B5E5B;border-radius:12px;padding:20px;display:flex;gap:24px;align-items:center;flex-wrap:wrap}
.key{font-family:ui-monospace,Consolas,monospace;font-size:17px;letter-spacing:.04em;word-break:break-all;margin:6px 0}.lbl{font-size:12px;color:#555;text-transform:uppercase;letter-spacing:.06em}
table{border-collapse:collapse;margin:18px 0;width:100%}td{padding:6px 8px;border-bottom:1px solid #ddd;font-size:14px}td:first-child{color:#555;width:180px}
.warn{background:#FDF2E1;border:1px solid #F3D9A8;border-radius:10px;padding:12px 14px;font-size:14px}.note{color:#555;font-size:13px}@media print{.noprint{display:none}}</style></head>
<body><p class="noprint note">Print this page (Ctrl+P) and keep the paper in two safe places. Then delete this file.</p>
<h1>Medoro backup recovery kit</h1><p class="sub">${esc(k.pharmacy)} · pharmacy code ${esc(k.code)}</p>
<div class="box">${qrSvg(k.key, { size: 190, title: "Backup decryption key" })}<div><div class="lbl">Backup decryption key</div><div class="key">${esc(groups)}</div>
<div class="lbl">Key fingerprint</div><div class="key">${esc(k.fingerprint)}</div></div></div>
<table><tr><td>Pharmacy</td><td>${esc(k.pharmacy)}</td></tr><tr><td>Pharmacy code</td><td>${esc(k.code)}</td></tr><tr><td>Created</td><td>${esc(created)}</td></tr>
<tr><td>If the server is lost</td><td>Set up Medoro again and enter this key to open your backups: type it without spaces, or scan the QR code with a phone and paste it.</td></tr></table>
<div class="warn">Keep this offline, in a locker or safe. Anyone with this key and your backup files can read your data. Without it, encrypted backups can’t be restored. Medoro does not keep a copy.</div>
</body></html>`;
}

/** Downloads the printable kit page. The key never leaves the browser. */
export function downloadRecoveryKit(k: Kit) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([recoveryKitHtml(k)], { type: "text/html;charset=utf-8" }));
  a.download = `medoro-recovery-kit-${k.code || "pharmacy"}.html`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 60_000);
}
