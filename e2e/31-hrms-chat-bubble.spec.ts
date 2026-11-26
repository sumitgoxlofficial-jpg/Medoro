import { hash } from "@node-rs/argon2";
import { test, expect, type Page } from "@playwright/test";
import { db, uid } from "./helpers";

/**
 * Spec 31 · The floating chat bubble in the HRMS. Two employees in the same department; one messages the other while the
 * other is on a page that is not the chat screen. The bubble then shows the sender's name and the message as a pop-up, the
 * unread count on the bubble, and opens a small window where the reply is sent without leaving the page.
 */
const tag = uid().toLowerCase();
const PASSWORD = `Bubble-${tag}-Password-26`;
const ANN = { name: `Ann ${tag.replace(/\d/g, "x")}`, email: `ann-${tag}@medoro.in` };
const BEN = { name: `Ben ${tag.replace(/\d/g, "x")}`, email: `ben-${tag}@medoro.in` };

test.use({ storageState: { cookies: [], origins: [] } });

async function employee(who: { name: string; email: string }, n: number) {
  const passwordHash = await hash(PASSWORD, { memoryCost: 19456, timeCost: 2, parallelism: 1 });
  await db().staffUser.create({
    data: {
      empNo: `MS-${700 + n * 100 + Math.floor(Math.random() * 90)}`, name: who.name, email: who.email, kind: "team", phone: `9${String(Math.floor(Math.random() * 1e9)).padStart(9, "0")}`, role: "employee", status: "active", passwordHash,
      hr: { create: { role: "employee", dept: "Bubble", designation: "Executive", profileDone: true, docsAcceptedAt: new Date(), kycSkippedAt: new Date(), mustChangePassword: false } },
    },
  });
}
async function signIn(page: Page, email: string) {
  await page.goto("/staff/employee");
  await page.locator("input[autocomplete=username]").fill(email);
  await page.locator("input[type=password]").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
}

test("a new message pops up on the floating chat bubble and can be answered from it", async ({ browser }) => {
  test.setTimeout(120_000);
  await employee(ANN, 1);
  await employee(BEN, 2);

  const annCtx = await browser.newContext(), benCtx = await browser.newContext();
  const ann = await annCtx.newPage(), ben = await benCtx.newPage();

  // Ann is on her home page (not the chat screen) with the bubble showing.
  await signIn(ann, ANN.email);
  await expect(ann).toHaveURL(/\/staff\/hrms/);
  const bubble = ann.getByRole("button", { name: "Messages", exact: true });
  await expect(bubble).toBeVisible();
  await ann.waitForTimeout(3000); // the first look at the chat list only sets the baseline

  // Ben starts a chat with Ann and writes to her.
  await signIn(ben, BEN.email);
  await expect(ben).toHaveURL(/\/staff\/hrms/); // sign-in finishes its own redirect first
  await ben.goto("/staff/hrms/chat");
  await ben.getByRole("button", { name: "New chat" }).click();
  await ben.getByRole("button", { name: new RegExp(ANN.name) }).click();
  await ben.getByLabel("Message", { exact: true }).fill("Hello Ann, are you free for a quick call?");
  await ben.getByRole("button", { name: "Send", exact: true }).click();

  // The pop-up shows who it is from and what they said; the bubble counts it.
  const popup = ann.getByRole("button", { name: new RegExp(`${BEN.name}.*Hello Ann`) });
  await expect(popup).toBeVisible({ timeout: 30_000 });
  await expect(ann.getByRole("button", { name: "Messages, 1 unread" })).toBeVisible();

  // Clicking it opens the conversation in a small window; Ann replies without leaving the page.
  await popup.click();
  const win = ann.getByRole("dialog", { name: `Chat with ${BEN.name}` });
  await expect(win.getByText("Hello Ann, are you free for a quick call?")).toBeVisible();
  await win.getByLabel("Message", { exact: true }).fill("Yes, calling you now");
  await win.getByRole("button", { name: "Send", exact: true }).click();
  await expect(win.getByText("Yes, calling you now")).toBeVisible();
  await expect(ann).toHaveURL(/\/staff\/hrms(?!\/chat)/); // still on the same page

  // Ben sees the reply on the full chat screen.
  await expect(ben.getByText("Yes, calling you now").first()).toBeVisible({ timeout: 30_000 });

  // On the chat screen itself there is no floating bubble (it is the full version).
  await ann.goto("/staff/hrms/chat");
  await expect(ann.getByRole("button", { name: /^Messages/ })).toHaveCount(0);
});
