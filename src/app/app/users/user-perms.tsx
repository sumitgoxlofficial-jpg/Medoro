"use client";
import { useState, useTransition } from "react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import type { Perm } from "@/domain/identity/permissions";
import { userPermAction } from "./actions";

type U = { id: string; name: string; role: string; rolePerms: string[]; grants: string[]; revokes: string[] };
type State = "role" | "grant" | "revoke";

export function overrideCount(u: { grants: string[]; revokes: string[] }) {
  return u.grants.length + u.revokes.length;
}

/** Per-user permissions on top of the role: follow the role, always allow, or never allow. */
export function UserPermsModal({ user, perms, onClose }: { user: U | null; perms: { id: Perm; label: string }[]; onClose: () => void }) {
  const toast = useToast();
  const [pending, start] = useTransition();
  const [over, setOver] = useState<Record<string, State>>({});
  const [lastId, setLastId] = useState<string | null>(null);
  if (user && user.id !== lastId) {
    setLastId(user.id);
    setOver(Object.fromEntries([...user.grants.map((p) => [p, "grant"]), ...user.revokes.map((p) => [p, "revoke"])]));
  }
  if (!user) return null;
  const set = (p: Perm, s: State) => start(async () => {
    const r = await userPermAction(user.id, p, s);
    if (!r.ok) return toast(r.error, "red");
    setOver((o) => ({ ...o, [p]: r.data === "granted" ? "grant" : r.data === "revoked" ? "revoke" : "role" }));
  });
  return (
    <Modal open onClose={onClose} title={`Permissions · ${user.name}`} sub={`${user.role} role, with changes for this person only`} width={560} footer={<Button onClick={onClose}>Done</Button>}>
      <div className="flex flex-col">
        {perms.map((p) => {
          const fromRole = user.rolePerms.includes(p.id), s = over[p.id] ?? "role";
          const on = s === "grant" || (s === "role" && fromRole);
          return (
            <div key={p.id} className="flex items-center gap-3 py-2 border-b border-row last:border-0 text-[13.5px]">
              <span className="flex-1 min-w-0">{p.label}<span className="block text-[12px] text-faint">{s === "role" ? `From role: ${fromRole ? "allowed" : "not allowed"}` : s === "grant" ? "Allowed for this person" : "Withheld from this person"}</span></span>
              <span className={on ? "text-ok text-[12px] font-semibold" : "text-faint text-[12px]"}>{on ? "Allowed" : "No"}</span>
              <select value={s} disabled={pending} aria-label={`${p.label} for ${user.name}`} onChange={(e) => set(p.id, e.target.value as State)} className="border border-input rounded-md px-2 py-1 text-[13px] bg-white">
                <option value="role">Follow role</option>
                {fromRole ? null : <option value="grant">Allow</option>}
                {fromRole ? <option value="revoke">Withhold</option> : null}
              </select>
            </div>
          );
        })}
      </div>
      <div className="text-[12px] text-faint">Applies on their next page load. Every change is in the audit trail. “View as” still only narrows what a person can do.</div>
    </Modal>
  );
}
