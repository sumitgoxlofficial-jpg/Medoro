"use client";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createPortal } from "react-dom";
import { CornerDownLeft, Search } from "lucide-react";
import type { Shell } from "@/staff/hrms/screens";
import { useBrowserValue } from "@/lib/react-state";
import { cx } from "./kit";

// Search the HRMS: a command palette (Ctrl+K / ⌘K, or the search box in the top bar) that jumps to any screen the person
// can open. Keyboard first: type to filter, ↑ ↓ to move, Enter to open, Esc to close.

type Item = { id: string; label: string; group: string };

/** Lower score is a better match; null when the query doesn't match at all (every character, in order). */
function score(q: string, text: string) {
  const t = text.toLowerCase();
  const at = t.indexOf(q);
  if (at === 0) return 0;
  if (at > 0) return 1 + at / 100;
  let i = 0;
  for (const ch of t) if (ch === q[i]) i++;
  return i === q.length ? 3 : null;
}

export function SearchButton({ onOpen }: { onOpen: () => void }) {
  const mac = useBrowserValue(() => /Mac|iPhone|iPad/.test(navigator.platform), false);
  return (
    <button type="button" onClick={onOpen} aria-label="Search the HRMS" className="hidden min-[700px]:flex items-center gap-2 h-9 w-[260px] max-w-[30vw] rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] px-3 text-[13px] text-[#64748B] cursor-pointer hover:border-[#94A3B8] hover:bg-white">
      <Search className="size-4" /><span className="flex-1 text-left truncate">Search pages…</span>
      <kbd className="text-[10.5px] font-semibold text-[#64748B] border border-[#E2E8F0] bg-white rounded px-1.5 py-0.5">{mac ? "⌘" : "Ctrl"} K</kbd>
    </button>
  );
}

export function CommandPalette({ sh, open, onOpen, onClose }: { sh: Shell; open: boolean; onOpen: () => void; onClose: () => void }) {
  const host = useBrowserValue<HTMLElement | null>(() => document.body, null);

  // Ctrl+K / ⌘K anywhere opens it; "/" too when not typing in a field.
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && (e.target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName));
      if ((e.key === "k" || e.key === "K") && (e.metaKey || e.ctrlKey)) { e.preventDefault(); onOpen(); }
      else if (e.key === "/" && !typing) { e.preventDefault(); onOpen(); }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [onOpen]);
  if (!open || !host) return null;
  // Mounted only while open, so every opening starts with an empty search.
  return createPortal(<Panel sh={sh} onClose={onClose} />, host);
}

function Panel({ sh, onClose }: { sh: Shell; onClose: () => void }) {
  const router = useRouter();
  const [q, setQ] = useState(""), [sel, setSel] = useState(0);
  const items: Item[] = useMemo(() => [...sh.nav.map((n) => ({ id: n.id, label: n.label, group: n.group || "Pages" })), { id: "profile", label: "My profile", group: "Account" }], [sh.nav]);
  const found = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return items;
    return items.map((it) => ({ it, s: Math.min(score(t, it.label) ?? 9, (score(t, it.group) ?? 9) + 2) })).filter((x) => x.s < 9).sort((a, b) => a.s - b.s).map((x) => x.it);
  }, [q, items]);
  const go = (it: Item | undefined) => { if (!it) return; onClose(); router.push(`/staff/hrms/${it.id}`); };
  const groups: [string, Item[]][] = [];
  for (const it of found) { const g = groups.find((x) => x[0] === it.group); if (g) g[1].push(it); else groups.push([it.group, [it]]); }
  let i = -1;
  return (
    <div className="fixed inset-0 z-[110] bg-[#0f172a]/40 backdrop-blur-[2px] flex items-start justify-center pt-[12vh] px-4" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div role="dialog" aria-label="Search the HRMS" className="cp-in w-full max-w-[560px] bg-white rounded-2xl shadow-[0_24px_60px_-20px_rgba(15,23,42,.5)] border border-[#E2E8F0] overflow-hidden">
        <div className="flex items-center gap-2.5 px-4 border-b border-[#EEF2F6]">
          <Search className="size-[18px] text-[#64748B]" />
          <input autoFocus value={q} onChange={(e) => { setQ(e.target.value); setSel(0); }} placeholder="Search pages, e.g. payslips, leave, attendance"
            aria-label="Search pages" role="combobox" aria-expanded aria-controls="cp-list" aria-activedescendant={found[sel] ? `cp-${found[sel].id}` : undefined}
            className="flex-1 h-12 outline-none text-[14.5px] bg-transparent"
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(found.length - 1, s + 1)); }
              else if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(0, s - 1)); }
              else if (e.key === "Enter") { e.preventDefault(); go(found[sel]); }
              else if (e.key === "Escape") { e.preventDefault(); onClose(); }
            }} />
          <kbd className="text-[10.5px] font-semibold text-[#64748B] border border-[#E2E8F0] rounded px-1.5 py-0.5">Esc</kbd>
        </div>
        <div id="cp-list" role="listbox" className="max-h-[52vh] overflow-y-auto py-2">
          {groups.length ? groups.map(([g, list]) => (
            <div key={g} className="px-2">
              <div className="px-2.5 pt-2 pb-1 text-[10.5px] font-bold tracking-[.1em] uppercase text-[#94A3B8]">{g}</div>
              {list.map((it) => { i++; const me = i; return (
                <button key={it.id} id={`cp-${it.id}`} role="option" aria-selected={sel === me} type="button" onMouseMove={() => setSel(me)} onClick={() => go(it)}
                  className={cx("w-full flex items-center gap-3 px-2.5 py-2 rounded-lg text-left text-[13.5px] cursor-pointer border-0", sel === me ? "bg-[#E6F4F2] text-[#0B5E5B]" : "bg-transparent text-[#0f172a]")}>
                  <span className="flex-1 font-medium">{it.label}</span>
                  {sel === me ? <CornerDownLeft className="size-3.5 opacity-70" /> : null}
                </button>
              ); })}
            </div>
          )) : <div className="px-4 py-8 text-center text-[13px] text-[#64748B]">No page matches “{q}”.</div>}
        </div>
        <div className="flex gap-4 px-4 py-2 border-t border-[#EEF2F6] bg-[#F8FAFC] text-[11px] text-[#64748B]"><span>↑ ↓ to move</span><span>Enter to open</span><span>Esc to close</span></div>
      </div>
    </div>
  );
}
