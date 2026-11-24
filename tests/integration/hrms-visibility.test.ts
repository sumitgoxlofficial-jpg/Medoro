import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const jar = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (k: string) => (jar.has(k) ? { value: jar.get(k) } : undefined), set: (k: string, v: string) => (v ? jar.set(k, v) : jar.delete(k)), delete: (k: string) => jar.delete(k) }),
  headers: async () => new Headers({ "x-forwarded-for": "10.0.0.9", "user-agent": "vitest" }),
}));
vi.mock("next/navigation", () => ({ redirect: (u: string) => { throw new Error("redirect " + u); } }));

import { db } from "@/server/db";
import { loadPerms, type Me } from "@/staff/hrms/auth";
import { chatList, chatMessages, chatPeople, groupInfo, openDm, createGroup, sendText, syncChannels } from "@/staff/hrms/chat";
import { roster, nameMap } from "@/staff/hrms/people";
import { whosOut } from "@/staff/hrms/time";
import { resetDb } from "./helpers";

let boss: Me, hr: Me, ann: Me, cat: Me, dan: Me;
const mkMe = async (id: string): Promise<Me> => { const u = await db.staffUser.findUniqueOrThrow({ where: { id }, include: { hr: true } }); return { id, empNo: u.empNo, name: u.name, first: u.name.split(" ")[0], email: u.email, staffRole: u.role, role: u.hr!.role, perms: await loadPerms(), sessionId: "t", phone: u.phone, personalEmail: "", dept: "", designation: "", photo: null, mustChangePassword: false, profileDone: true, docsAccepted: true, kycSubmitted: true, kycSkipped: false, kycVerified: true }; };
const mk = (n: number, name: string, role: "super_admin" | "employee", hrRole: "admin" | "employee" | "hr", dept: string, managerId?: string) =>
  db.staffUser.create({ data: { empNo: `MS-50${n}`, name, email: `${name.split(" ")[0].toLowerCase()}@medoro.in`, kind: "team", phone: `98700000${n}0`, role, status: "active", hr: { create: { role: hrRole, dept, managerId: managerId ?? null, profileDone: true, docsAcceptedAt: new Date() } } } });
const names = async (me: Me) => (await chatPeople(me)).map((p) => p.name).sort();

beforeAll(async () => {
  await resetDb();
  process.env.SESSION_SECRET ||= "test-only-secret-0123456789abcdef0123";
  const b = await mk(1, "Sunita Boss", "super_admin", "admin", "Management");
  const h = await mk(2, "Hema HR", "employee", "hr", "People");
  const m = await mk(3, "Mohan Manager", "employee", "employee", "Ops");
  const a = await mk(4, "Ann Ops", "employee", "employee", "Ops", m.id);
  const c = await mk(5, "Cat Ops", "employee", "employee", "Ops", m.id);
  const d = await mk(6, "Dan Sales", "employee", "employee", "Sales");
  [boss, hr, , ann, cat, dan] = await Promise.all([b, h, m, a, c, d].map((u) => mkMe(u.id)));
});
beforeEach(() => jar.clear());

describe("who an employee can see", () => {
  it("an ordinary employee sees only their team and HR, never the super admin", async () => {
    expect(await names(ann)).toEqual(["Cat Ops", "Hema HR", "Mohan Manager"]); // not Dan (other dept), not the super admin
    expect(await names(dan)).toEqual(["Hema HR"]);
  });
  it("HR sees everyone except the super admin", async () => {
    expect(await names(hr)).toEqual(["Ann Ops", "Cat Ops", "Dan Sales", "Mohan Manager"]);
  });
  it("the super admin sees everyone", async () => {
    expect(await names(boss)).toEqual(["Ann Ops", "Cat Ops", "Dan Sales", "Hema HR", "Mohan Manager"]);
  });
  it("an employee can't start a chat or group with someone outside their team, or with the super admin", async () => {
    await expect(openDm(ann, dan.id)).rejects.toThrow(/isn’t available/);
    await expect(openDm(ann, boss.id)).rejects.toThrow(/isn’t available/);
    await expect(createGroup(ann, "Sneaky", [dan.id])).rejects.toThrow(/isn’t available/);
    await expect(openDm(ann, cat.id)).resolves.toHaveProperty("chatId");
  });
  it("the directory of employees and name lookups hide the super admin from everyone else", async () => {
    expect((await roster({ viewer: hr })).map((p) => p.name)).not.toContain("Sunita Boss");
    expect((await roster({ viewer: boss })).map((p) => p.name)).toContain("Sunita Boss");
    expect((await nameMap(ann)).get(boss.id)).toBe("Admin");
    expect((await nameMap(boss)).get(boss.id)).toBe("Sunita Boss");
  });
  it("the super admin shows as Admin in chats, and a company channel lists only your team", async () => {
    const dm = (await openDm(boss, ann.id)).chatId;
    await sendText(boss, dm, "Please send the report");
    const list = await chatList(ann);
    expect(list.find((c) => c.id === dm)?.title).toBe("Admin");
    const thread = await chatMessages(ann, dm, null, true);
    expect(thread.msgs.at(-1)).toMatchObject({ by: "Admin", body: "Please send the report" });
    expect((await chatList(boss)).find((c) => c.id === dm)?.title).toBe("Ann Ops");
    expect((await chatMessages(boss, dm, null, false)).msgs.at(-1)?.by).toBe("Sunita Boss");
    await syncChannels(true);
    const all = (await chatList(ann)).find((c) => c.title === "All Hands")!;
    const info = await groupInfo(ann, all.id);
    expect(info.members.map((x) => x.name).sort()).toEqual(["Ann Ops", "Cat Ops", "Hema HR", "Mohan Manager"]);
    expect(info.more).toBe(1); // Dan, outside the team; the super admin isn't counted or named
  });
  it("leave on the calendar: your team and HR only, never the super admin", async () => {
    const day = new Date(Date.now() + 5 * 86400_000).toISOString().slice(0, 10);
    for (const u of [boss, cat, dan]) await db.hrLeave.create({ data: { staffId: u.id, type: "casual", fromDay: new Date(day), toDay: new Date(day), days: 1, status: "approved", reason: "x" } });
    expect((await whosOut(day, day, ann)).map((l) => l.name)).toEqual(["Cat Ops"]);
    expect((await whosOut(day, day, boss)).map((l) => l.name).sort()).toEqual(["Cat Ops", "Dan Sales", "Sunita Boss"]);
  });
});
