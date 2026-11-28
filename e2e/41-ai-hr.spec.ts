import { execFileSync } from "node:child_process";
import path from "node:path";
import { hash } from "@node-rs/argon2";
import { test, expect, type Page } from "@playwright/test";
import { db, uid } from "./helpers";

/**
 * Spec 41 · AI HR Assistant on the production build. The super admin switches it on, HR asks the assistant to follow up
 * with an employee, the employee has the conversation in the browser (typed), HR sees the structured outcome, opens the
 * transcript and decides the follow-up; the playground runs; the microphone is allowed on HRMS pages only.
 */
const tag = uid().toLowerCase();
const ADMIN = { email: `ai-admin-${tag}@medoro.in`, otp: `One-Time-${tag}-Pass`, password: `Admin-${tag}-Password-26` };
const EMP = { email: `neha.${tag}@medoro.in`, password: `Neha-${tag}-Password-26`, name: `Neha ${tag.replace(/\d/g, "x")}` };

// Full Chromium in headless mode: Playwright's default chrome-headless-shell reports web notifications as denied, so
// the "Let Naina ring this device" switch can't be tested with it (this spec failed in CI for that reason).
test.use({ storageState: { cookies: [], origins: [] }, channel: "chromium" });

async function signIn(page: Page, id: string, password: string) {
  await page.goto("/staff/employee");
  await page.locator("input[autocomplete=username]").fill(id);
  await page.locator("input[type=password]").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

test("AI HR Assistant: switch on, follow-up conversation in the browser, HR review, playground, microphone policy", async ({ page, browser }) => {
  test.setTimeout(180_000);
  execFileSync("node", [path.join(__dirname, "..", "scripts", "create-super-admin.mjs"), ADMIN.email, ADMIN.otp, "AI Admin", "9811000041"], { stdio: "pipe" });
  await signIn(page, ADMIN.email, ADMIN.otp);
  await expect(page.getByText("Set your own password")).toBeVisible();
  await page.locator("input[type=password]").nth(0).fill(ADMIN.password);
  await page.locator("input[type=password]").nth(1).fill(ADMIN.password);
  await page.getByRole("button", { name: "Save password" }).click();
  await expect(page.getByText("Employee database")).toBeVisible();

  // An employee who has finished first sign-in (that flow is covered by spec 30).
  const p = db();
  await p.staffUser.create({ data: { empNo: `MS-A${tag.slice(0, 3)}`, name: EMP.name, email: EMP.email, kind: "team", phone: "97" + String(Date.now()).slice(-8), role: "employee", status: "active", passwordHash: await hash(EMP.password, { memoryCost: 19456, timeCost: 2, parallelism: 1 }), hr: { create: { role: "employee", dept: "Ops", designation: "Executive", profileDone: true, docsAcceptedAt: new Date(), kycSubmittedAt: new Date(), joinDate: new Date("2026-01-05") } } } });

  // The microphone is allowed on HRMS pages (for voice answers) and nowhere else.
  const res = await page.request.get("/staff/hrms/aicall");
  expect(res.headers()["permissions-policy"]).toContain("microphone=(self)");
  expect((await page.request.get("/legal")).headers()["permissions-policy"]).toContain("microphone=()");

  // Settings: switch it on, voice on the employee's device (free).
  await page.goto("/staff/hrms/aihr?tab=settings");
  await page.getByLabel("Automatic AI conversations on").check();
  await expect(page.getByLabel(/^Voice/)).toHaveValue("browser");
  await expect(page.getByLabel(/^Naina's voice/)).toHaveValue("device");
  await page.getByRole("button", { name: "Save settings" }).click();
  await expect(page.getByText("AI HR Assistant settings saved.")).toBeVisible();

  // Overview counts from the database, then ask the assistant to follow up with the employee.
  await page.goto("/staff/hrms/aihr");
  await expect(page.getByText("Conversations (30 days)")).toBeVisible();
  const followUp = page.locator("section", { hasText: "Ask the assistant to follow up" });
  await followUp.getByLabel("Employee").selectOption({ label: `${EMP.name} (MS-A${tag.slice(0, 3)})` });
  await followUp.getByLabel("About").fill("Leave questions");
  await followUp.getByRole("button", { name: "Schedule follow-up" }).click();
  await expect(page.getByText("Follow-up conversation scheduled.")).toBeVisible();

  // The employee talks to the assistant (typed: the same path voice uses after recognition).
  const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] }, permissions: ["notifications"] });
  const e = await ctx.newPage();
  await signIn(e, EMP.email, EMP.password);
  await e.waitForURL(/\/staff\/hrms/);
  await e.goto("/staff/hrms/aicall");
  await expect(e.getByText("AI conversations on")).toBeVisible();
  await e.getByRole("button", { name: "Talk now" }).click();
  await expect(e.getByText(/Main Naina hoon|I'm Naina|this is Naina/).first()).toBeVisible();
  // Headless Chromium has no installed voices: the employee is told replies are text-only and how to add a Hindi voice.
  await expect(e.getByText(/no Hindi voice installed/)).toBeVisible();
  await e.getByPlaceholder("Type your answer (Hindi, English or Hinglish)").fill("Leave cancel kaise karte hain HRMS mein?");
  await e.getByRole("button", { name: "Send", exact: true }).click();
  await expect(e.getByText(/Source: Cancelling leave/)).toBeVisible();
  await expect(e.getByText("Conversation finished. Thank you.")).toBeVisible();
  await e.getByRole("button", { name: "Close" }).click();

  // The employee can switch AI conversations off and on again.
  const choice = e.locator("section", { hasText: "Your choice" });
  await choice.getByRole("button", { name: "Turn off" }).click();
  await expect(e.getByText("AI conversations off", { exact: true })).toBeVisible();
  await choice.getByRole("button", { name: "Turn on" }).click();
  await expect(e.getByText("AI conversations on", { exact: true })).toBeVisible();

  // Naina is pinned in Chats: a typed question is answered from approved knowledge, with its source.
  await e.goto("/staff/hrms/chat?c=naina");
  await expect(e.getByRole("listitem", { name: "Naina, AI HR assistant" })).toBeVisible();
  await e.getByLabel("Message Naina").fill("payslip kahan milegi");
  await e.getByRole("button", { name: "Send to Naina" }).click();
  await expect(e.getByText(/Source: Payslips/).first()).toBeVisible();

  // Naina rings inside the HRMS for a conversation the scheduler has sent (no phone): Answer opens the call window.
  const staffId = (await p.staffUser.findFirstOrThrow({ where: { email: EMP.email } })).id;
  const istDay = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
  await p.aiHrCall.create({ data: { staffId, reason: "manual", day: new Date(`${istDay}T00:00:00Z`), eventKey: `manual:${staffId}:e2e-ring`, status: "notified", attempts: 1, maxAttempts: 3, nextAttemptAt: new Date(Date.now() + 3600_000), context: { topic: "Check documents" } } });
  // The call works like a phone call. A fake device voice and the browser's speech recognition stand in for the
  // speaker and microphone: Naina speaks, listens by herself, hears a Hindi answer (Devanagari), and ends the call.
  await e.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    // "" is a few seconds of nothing heard (the browser's "no-speech"), as when someone starts talking late.
    const said = ["", "haan, boliye", "मुझे एचआर से बात करनी है"];
    const spoken: string[] = []; w.__spoken = spoken;
    const voice = { name: "Lekha", lang: "hi-IN", localService: true, default: true, voiceURI: "Lekha" };
    w.SpeechSynthesisUtterance = class { text: string; voice: unknown = null; lang = ""; rate = 1; pitch = 1; volume = 1; onend: (() => void) | null = null; onerror: (() => void) | null = null; constructor(t: string) { this.text = t; } };
    Object.defineProperty(window, "speechSynthesis", { configurable: true, value: { getVoices: () => [voice], cancel() {}, pause() {}, resume() {}, addEventListener() {}, removeEventListener() {}, speaking: false, pending: false, paused: false, speak(u: { text: string; onend?: () => void }) { spoken.push(u.text); setTimeout(() => u.onend?.(), 150); } } });
    type R = { results: { length: number; [i: number]: { isFinal: boolean; length: number; [j: number]: { transcript: string; confidence: number } } }; resultIndex: number };
    class FakeRec {
      lang = ""; interimResults = false; continuous = false; maxAlternatives = 1;
      onresult: ((e: R) => void) | null = null; onerror: ((e: { error: string }) => void) | null = null; onend: (() => void) | null = null; onspeechstart = null;
      start() {
        const t = said.shift(); w.__recLang = this.lang;
        setTimeout(() => {
          const res = (text: string, isFinal: boolean): R => ({ resultIndex: 0, results: { length: 1, 0: { isFinal, length: 1, 0: { transcript: text, confidence: 0.9 } } } });
          if (t) { this.onresult?.(res(t.split(" ")[0], false)); this.onresult?.(res(t, true)); } else this.onerror?.({ error: "no-speech" });
          this.onend?.();
        }, 400);
      }
      stop() {}
      abort() { this.onerror?.({ error: "aborted" }); this.onend?.(); }
    }
    w.SpeechRecognition = FakeRec; w.webkitSpeechRecognition = FakeRec;
  });
  await e.goto("/staff/hrms/attendance");
  const ringing = e.getByRole("alertdialog", { name: "Naina is calling" });
  await expect(ringing).toBeVisible({ timeout: 20_000 });
  await ringing.getByRole("button", { name: "📞 Answer" }).click();
  const callWin = e.getByRole("dialog", { name: "Call with Naina" });
  const captions = callWin.getByLabel("Captions");
  await expect(captions.getByText(/Naina hoon|I'm Naina|this is Naina/).first()).toBeVisible();
  await expect(captions.getByText("haan, boliye")).toBeVisible(); // she kept listening instead of taking silence
  await expect(captions.getByText("(silence)")).toHaveCount(0);
  await expect(captions.getByText(/madad kar sakti hoon/)).toBeVisible();
  await expect(captions.getByText("मुझे एचआर से बात करनी है")).toBeVisible();
  await expect(captions.getByText(/HR team ko bata deti hoon|एचआर टीम को|HR टीम को/).first()).toBeVisible();
  await expect(callWin.getByRole("status")).toContainText("Call ended", { timeout: 15_000 });
  expect(await e.evaluate(() => (window as unknown as { __recLang: string }).__recLang)).toBe("hi-IN");
  const spoken = await e.evaluate(() => (window as unknown as { __spoken: string[] }).__spoken.filter((x) => x.trim()));
  expect(spoken.length).toBeGreaterThanOrEqual(3); // her opening, the question and the goodbye, spoken aloud
  expect(spoken[0]).toMatch(/नैना/); // in Devanagari for the Hindi voice
  await callWin.getByRole("button", { name: "Close" }).click();
  await expect(ringing).toBeHidden();

  // Naina can ring the device with the HRMS closed (free browser push): the switch is offered in her chat, and the
  // service worker turns a push into a ringing notification that opens her chat.
  await e.goto("/staff/hrms/chat?c=naina");
  await expect(e.getByText("Let Naina ring this device")).toBeVisible();
  await expect(e.getByRole("button", { name: "Turn on" })).toBeVisible();
  const cdp = await ctx.newCDPSession(e);
  const reg = new Promise<string>((ok) => cdp.on("ServiceWorker.workerRegistrationUpdated", (ev: { registrations: { registrationId: string; scopeURL: string; isDeleted: boolean }[] }) => { const r = ev.registrations.find((x) => !x.isDeleted); if (r) ok(r.registrationId); }));
  await e.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  await cdp.send("ServiceWorker.enable");
  await cdp.send("ServiceWorker.deliverPushMessage", { origin: new URL(e.url()).origin, registrationId: await reg, data: JSON.stringify({ title: "📞 Naina · AI HR is calling", body: "About today's check-in. Tap to answer in the HRMS.", url: "/staff/hrms/chat?c=naina", tag: "naina-e2e" }) });
  await expect.poll(() => e.evaluate(async () => (await (await navigator.serviceWorker.ready).getNotifications()).map((n) => `${n.title} | ${n.body} | ${(n.data as { url: string }).url} | ${n.requireInteraction}`))).toEqual(["📞 Naina · AI HR is calling | About today's check-in. Tap to answer in the HRMS. | /staff/hrms/chat?c=naina | true"]);
  await ctx.close();

  // HR sees the outcome and the transcript (the opening is audited).
  await page.goto("/staff/hrms/aihr?tab=calls");
  const row = page.getByRole("row", { name: new RegExp(EMP.name) }).last(); // the oldest: the follow-up about leave
  await expect(row.getByText("completed")).toBeVisible();
  await row.getByRole("button", { name: "Open" }).click();
  await expect(page.getByText(/Leave cancel kaise karte hain/)).toBeVisible();
  await expect(page.getByText(/Nothing here changed attendance, leave or pay/)).toBeVisible();
  expect(await p.staffAudit.count({ where: { action: "HRMS · AI conversation transcript opened" } })).toBeGreaterThan(0);
  await page.keyboard.press("Escape");

  // Escalations & review lists answers the assistant didn't understand (none in this conversation).
  await page.goto("/staff/hrms/aihr?tab=escalations");
  await expect(page.getByText("Answers not understood")).toBeVisible();
  await expect(page.getByText("Nothing to review: the assistant understood every answer.")).toBeVisible();

  // Settings has the weekly summary switch (email isn't set up in this test server).
  await page.goto("/staff/hrms/aihr?tab=settings");
  await expect(page.getByLabel(/Weekly summary email/)).toBeChecked();

  // Knowledge: retrieval test answers with its source.
  await page.goto("/staff/hrms/aihr?tab=knowledge");
  await page.getByPlaceholder("Leave cancel kaise karte hain?").fill("payslip kahan milegi");
  await page.getByRole("button", { name: "Ask" }).click();
  await expect(page.getByText(/Payslips and tax statement/).first()).toBeVisible();

  // Playground: nobody is contacted; the outcome is structured.
  await page.goto("/staff/hrms/aihr?tab=playground");
  await page.getByRole("button", { name: "Start" }).click();
  await page.getByPlaceholder(/Haan, traffic mein hoon/).fill("traffic mein hoon, 20 minute mein pahunch jaunga");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText(/expected arrival .* note kar rahi hoon/)).toBeVisible();
  await expect(page.locator("pre")).toContainText('"employeeResponse": "coming"');
  await expect(page.locator("pre")).toContainText('"reasonCategory": "traffic"');

  // Scenario evaluation from the screen.
  await page.goto("/staff/hrms/aihr?tab=scenarios");
  await page.getByRole("button", { name: "Run evaluation" }).click();
  await expect(page.getByText(/Evaluation finished: 1060\/1060 passed/)).toBeVisible({ timeout: 60_000 });
});
