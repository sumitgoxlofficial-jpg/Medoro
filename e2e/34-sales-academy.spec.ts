import { readFileSync } from "node:fs";
import { hash } from "@node-rs/argon2";
import { test, expect, type Browser, type Page } from "@playwright/test";
import { db, uid } from "./helpers";

/**
 * Spec 34 · HRMS Sales Training Academy, end to end through the real UI on a production build.
 *
 * HR installs the course, edits settings, content, quizzes, scenarios, files and the timetable, and creates batches.
 * A sales employee really watches an official tour video and really studies a slide lecture (real heartbeats, real
 * time), takes the product quiz (fail, then pass) and the final exam, and submits both practicals. The trainer scores them
 * (a failed demo, a retake), marks attendance, sends back, reopens and recommends. HR approves, the certificate is issued,
 * downloaded and verified publicly, the report downloads, and finally the certificate is revoked. Access rules, a broken
 * video, a blocked video host and phone width are checked along the way.
 *
 * Fixtures written to the database (not what this spec tests): the five people's HRMS profiles (creating staff is spec
 * 30), and the completion of the lessons this spec doesn't sit through (watching the 50-minute tour is not practical in
 * CI; real video and slide evidence is exercised on one lesson each).
 */
const tag = uid().toLowerCase();
const PW = `Academy-${tag}-Password-26`;
type Person = { empNo: string; name: string; role: "hr" | "employee" | "sales"; dept: string; staffRole: "employee" | "sales" };
const P: Record<"hr" | "trainer" | "sam" | "priya" | "om", Person> = {
  hr: { empNo: `MS-H${tag}`, name: `Hema ${tag}`, role: "hr", dept: "HR", staffRole: "employee" },
  trainer: { empNo: `MS-T${tag}`, name: `Tarun ${tag}`, role: "employee", dept: "Training", staffRole: "employee" },
  sam: { empNo: `MS-S${tag}`, name: `Sameer ${tag}`, role: "sales", dept: "Sales", staffRole: "sales" },
  priya: { empNo: `MS-P${tag}`, name: `Priya ${tag}`, role: "employee", dept: "Sales", staffRole: "employee" },
  om: { empNo: `MS-O${tag}`, name: `Om ${tag}`, role: "employee", dept: "Operations", staffRole: "employee" },
};

test.use({ storageState: { cookies: [], origins: [] } });

async function seedPeople() {
  const passwordHash = await hash(PW, { memoryCost: 19456, timeCost: 2, parallelism: 1 });
  let n = 0;
  for (const p of Object.values(P)) {
    n++;
    await db().staffUser.create({ data: {
      empNo: p.empNo, name: p.name, email: `${p.empNo.toLowerCase()}@medoro.in`, kind: "team", phone: `98${String(Date.now()).slice(-7)}${n}`, role: p.staffRole, status: "active", passwordHash,
      hr: { create: { role: p.role, dept: p.dept, designation: p.role === "hr" ? "HR Manager" : "Sales Executive", profileDone: true, docsAcceptedAt: new Date(), kycSubmittedAt: new Date(), kycVerifiedAt: new Date() } },
    } });
  }
}
async function signIn(browser: Browser, who: Person, viewport = { width: 1360, height: 900 }) {
  const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] }, viewport, acceptDownloads: true });
  const page = await ctx.newPage();
  await page.goto("/staff/employee");
  await page.locator("input[autocomplete=username]").fill(who.empNo);
  await page.locator("input[type=password]").fill(PW);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/staff\/hrms\//);
  page.on("dialog", (d) => void d.accept());
  return page;
}
const toast = (page: Page, text: string | RegExp) => expect(page.getByRole("status").filter({ hasText: text }).first()).toBeVisible({ timeout: 30_000 });
const dialog = (page: Page) => page.getByRole("dialog");
const field = (scope: Page | ReturnType<Page["getByRole"]>, label: RegExp) => scope.locator("label").filter({ hasText: label }).locator("input, select, textarea").first();
const staffId = async (p: Person) => (await db().staffUser.findUniqueOrThrow({ where: { empNo: p.empNo } })).id;
const assignment = async (p: Person) => db().trAssignment.findFirstOrThrow({ where: { staffId: await staffId(p) } });
/** Correct option text for each published question, in screen order. */
async function key(where: object) {
  return (await db().trQuestion.findMany({ where: { ...where, status: "published" }, orderBy: { order: "asc" } })).map((q) => ({ id: q.id, right: (q.options as string[])[q.answer], wrong: (q.options as string[])[(q.answer + 1) % (q.options as string[]).length] }));
}
async function answer(scope: Page | ReturnType<Page["getByRole"]>, texts: string[]) {
  const sets = scope.locator("fieldset");
  await expect(sets).toHaveCount(texts.length);
  for (const [k, t] of texts.entries()) await sets.nth(k).getByText(t, { exact: true }).click();
}

test("Sales Academy: HR set-up, real learning, assessments, trainer review, HR approval and the certificate", async ({ browser, request }) => {
  test.setTimeout(20 * 60_000);
  await seedPeople();

  // ── HR: install, settings, batches
  const hr = await signIn(browser, P.hr);
  await hr.goto("/staff/hrms/academy");
  await hr.getByRole("button", { name: /Install the standard course/ }).click();
  await toast(hr, /Installed: 38 lessons/);
  await expect(hr.getByRole("button", { name: "Training Overview" })).toBeVisible();

  await hr.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(field(hr, /^Final score to pass/)).toBeDisabled(); // rules are the super admin's
  await field(hr, /^Approved pricing/).fill(`Plans as on medoro.in/pricing only. No discounts without manager approval. ${tag}`);
  await field(hr, /^Authorised signatory/).fill("Head of HR");
  await hr.getByRole("button", { name: "Save", exact: true }).click();
  await toast(hr, "Settings saved.");

  const today = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
  for (const [name, people] of [[`Batch A ${tag}`, [P.sam, P.priya, P.om]], [`Batch B ${tag}`, []]] as const) {
    await hr.getByRole("button", { name: "Training Batches" }).click();
    await hr.getByPlaceholder(/e.g. Sales Batch/).fill(name);
    await field(hr, /^Training date/).fill(today);
    await field(hr, /^Trainer/).selectOption({ label: `${P.trainer.name} · ${P.trainer.empNo}` });
    if (people.length) {
      await hr.getByText(/Show everyone/).click(); // Om is not in sales: shown only with this, and refused by the server
      for (const p of people) await hr.locator("label").filter({ has: hr.locator("input[type=checkbox]") }).filter({ hasText: p.name }).click();
    }
    await hr.getByRole("button", { name: "Create batch & assign" }).click();
    await toast(hr, people.length ? new RegExp(`2 assigned; skipped: ${P.om.name} \\(not in the sales team`) : /Batch created\. 0 assigned/);
  }

  // ── HR: content management
  await hr.getByRole("button", { name: "Course Builder" }).click();
  const lessonRow = (title: RegExp) => hr.locator("li").filter({ hasText: title });
  await lessonRow(/Lesson 3: Sales Mindset/).getByRole("button", { name: "Edit" }).click();
  await field(dialog(hr), /^Title/).fill("Lesson 3: Sales Mindset and Professional Communication (edited)");
  await dialog(hr).getByRole("button", { name: "Save as v2" }).click();
  await toast(hr, "Lesson saved (new version).");
  await lessonRow(/\(edited\)/).getByRole("button", { name: "Edit" }).click();
  await dialog(hr).getByText(/Earlier versions/).click();
  await dialog(hr).getByRole("button", { name: "Restore" }).first().click();
  await toast(hr, "Version restored.");
  await expect(lessonRow(/\(edited\)/)).toHaveCount(0);

  // A video on a host the security policy blocks is refused; an optional lesson with a missing video file is allowed.
  const mod = hr.locator("section").filter({ hasText: "Negotiation and Sales Closing" }).filter({ has: hr.getByPlaceholder("New lesson title") }).first();
  await mod.getByPlaceholder("New lesson title").fill(`Broken video check ${tag}`);
  await mod.getByRole("button", { name: /Add draft lesson/ }).click();
  await toast(hr, "Draft lesson added.");
  await lessonRow(new RegExp(`Broken video check ${tag}`)).getByRole("button", { name: "Edit" }).click();
  await field(dialog(hr), /^Status/).selectOption("published");
  await dialog(hr).getByText("Mandatory for the certificate").click();
  await field(dialog(hr), /^Source/).selectOption("file");
  await field(dialog(hr), /^Video URL/).fill("https://videos.example.com/lesson.mp4");
  await dialog(hr).getByRole("button", { name: /Save as v/ }).click();
  await toast(hr, /blocked by the security policy/);
  await field(dialog(hr), /^Video URL/).fill("/videos/files/does-not-exist.mp4");
  await field(dialog(hr), /^Length/).fill("60");
  await dialog(hr).getByRole("button", { name: /Save as v/ }).click();
  await toast(hr, "Lesson saved (new version).");

  await hr.getByRole("button", { name: "Edit timetable" }).click();
  await dialog(hr).getByRole("button", { name: /Add row/ }).click();
  await dialog(hr).getByLabel("Title").last().fill(`Feedback circle ${tag}`);
  await dialog(hr).getByRole("button", { name: "Save timetable" }).click();
  await toast(hr, "Schedule saved.");

  await hr.getByRole("button", { name: "Video & PPT Library" }).click();
  const libRow = hr.locator("tr").filter({ hasText: "Lesson 4: Cold Calling" });
  await libRow.locator("input[type=file]").setInputFiles({ name: `call-sheet-${tag}.pdf`, mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n% call sheet\n%%EOF\n") });
  await toast(hr, "File uploaded.");
  await libRow.getByPlaceholder("Link name").fill("Pricing page");
  await libRow.getByPlaceholder("https://").fill("https://medoro.in/pricing");
  await libRow.getByRole("button", { name: "Add", exact: true }).click();
  await toast(hr, "Link added.");
  await libRow.getByRole("button", { name: "Remove Pricing page" }).click();
  await toast(hr, "Removed.");
  // A file that only claims to be a PDF is refused.
  await libRow.locator("input[type=file]").setInputFiles({ name: "fake.pdf", mimeType: "application/pdf", buffer: Buffer.from("not really a pdf") });
  await toast(hr, /isn’t really a PDF/);

  await hr.getByRole("button", { name: "Quiz Management" }).click();
  await hr.getByRole("button", { name: /Add question/ }).click();
  await field(dialog(hr), /^Quiz/).selectOption("final");
  await field(dialog(hr), /^Assessment area/).selectOption("crm");
  await field(dialog(hr), /^Question/).fill(`Follow-up date kab set karein? ${tag}`);
  const optionInputs = dialog(hr).locator("div.flex.gap-2.items-center input:not([type=radio])");
  for (const [k, t] of ["Har call ke baad", "Kabhi nahi", "Mahine mein ek baar", "Sirf won par"].entries()) await optionInputs.nth(k).fill(t);
  await field(dialog(hr), /^Explanation/).fill("Har lead ka agla step hamesha CRM mein.");
  await dialog(hr).getByRole("button", { name: "Save question" }).click();
  await toast(hr, "Question saved.");

  await hr.getByRole("button", { name: "Practical Assessments" }).click();
  await hr.getByRole("button", { name: /Add scenario/ }).click();
  await field(dialog(hr), /^Title/).fill(`Hospital pharmacy buyer ${tag}`);
  await field(dialog(hr), /^Customer persona/).fill("Purchase head of a 100-bed hospital pharmacy.");
  await field(dialog(hr), /^Customer lines/).fill("Customer: Hamein multi-counter chahiye.\nCoach: Ask about counters and approvals.");
  await field(dialog(hr), /^Goals/).fill("Discovery on counters\nBook a demo");
  await dialog(hr).getByRole("button", { name: "Save" }).click();
  await toast(hr, "Scenario saved.");

  // ── Access: someone outside the programme sees nothing of it
  const om = await signIn(browser, P.om);
  await expect(om.getByRole("link", { name: "My Sales Training" })).toHaveCount(0);
  await om.goto("/staff/hrms/training");
  await expect(om.getByText("No training has been assigned to you.")).toBeVisible();
  await om.goto("/staff/hrms/academy");
  await expect(om).not.toHaveURL(/academy/);

  // ── Employee: real video evidence on an official tour chapter
  const sam = await signIn(browser, P.sam);
  await expect(sam.getByRole("link", { name: "My Sales Training" })).toBeVisible();
  await sam.goto("/staff/hrms/training");
  await expect(sam.getByText(/Medoro Sales Training Academy/).first()).toBeVisible();
  await sam.getByRole("button", { name: "Product Tour" }).click();
  await sam.getByRole("link", { name: /01\. Introduction to Medoro/ }).click();
  const video = sam.locator("video");
  await expect(video).toHaveAttribute("src", /\/videos\/files\/part-01-introduction-to-medoro\.mp4$/);
  await sam.waitForFunction(() => ((document.querySelector("video") as HTMLVideoElement | null)?.readyState ?? 0) >= 1);
  await sam.getByLabel("Speed").selectOption("2");
  await sam.evaluate(() => { const v = document.querySelector("video")!; v.muted = true; return v.play(); });
  await expect(sam.getByText(/Watched (9\d|100)%/)).toBeVisible({ timeout: 120_000 });
  const tour01 = await db().trLesson.findFirstOrThrow({ where: { slug: "tour-01" } });
  await answer(sam, (await key({ lessonId: tour01.id, scope: "lesson" })).map((q) => q.right));
  await sam.getByRole("button", { name: "Submit answers" }).click();
  await expect(sam.getByText("Passed!")).toBeVisible();
  await expect(sam.getByText("Lesson complete!")).toBeVisible();

  // Real slide evidence: every slide studied for its minimum time, then the check.
  await sam.goto("/staff/hrms/training?tab=modules");
  await sam.getByRole("link", { name: /Welcome to Medoro Sales Academy/ }).click();
  await expect(sam.getByRole("button", { name: "Play narration" })).toBeVisible();
  const total = await sam.locator('[aria-label="Slides"] button').count();
  expect(total).toBeGreaterThan(3);
  for (let k = 0; k < total; k++) {
    const need = Number((await sam.getByText(/about \d+ seconds/).innerText()).match(/about (\d+) seconds/)![1]);
    await sam.waitForTimeout((need + 12) * 1000);
    if (k < total - 1) await sam.keyboard.press("ArrowRight");
  }
  await expect(sam.getByText(`${total}/${total} studied`)).toBeVisible({ timeout: 30_000 });
  const welcome = await db().trLesson.findFirstOrThrow({ where: { slug: "welcome" } });
  await answer(sam, (await key({ lessonId: welcome.id, scope: "lesson" })).map((q) => q.right));
  await sam.getByRole("button", { name: "Submit answers" }).click();
  await expect(sam.getByText("Lesson complete!")).toBeVisible();

  // A broken video says so instead of failing silently.
  await sam.goto("/staff/hrms/training?tab=modules");
  await sam.getByRole("link", { name: new RegExp(`Broken video check ${tag}`) }).click();
  await expect(sam.getByRole("alert").filter({ hasText: "couldn’t load" })).toBeVisible();

  // Fixture: the remaining mandatory lessons complete (see the note at the top).
  const a = await assignment(P.sam);
  for (const l of await db().trLesson.findMany({ where: { status: "published", mandatory: true } })) {
    await db().trProgress.upsert({ where: { assignmentId_lessonId: { assignmentId: a.id, lessonId: l.id } }, create: { assignmentId: a.id, lessonId: l.id, completedAt: new Date() }, update: { completedAt: new Date() } });
  }

  // ── Employee: product quiz (fail, review, pass) and final exam
  await sam.goto("/staff/hrms/training?tab=assess");
  const product = await key({ scope: "product" });
  await sam.getByRole("button", { name: "Start quiz" }).click();
  await answer(dialog(sam), product.map((q) => q.wrong));
  await dialog(sam).getByRole("button", { name: "Submit" }).click();
  await expect(dialog(sam).getByText("Not passed yet")).toBeVisible();
  await expect(dialog(sam).getByText("Correct answer:").first()).toBeVisible();
  await dialog(sam).getByRole("button", { name: "Close", exact: true }).first().click();
  await expect(sam.getByText("attempts left: 2").first()).toBeVisible();
  await sam.getByRole("button", { name: "Start quiz" }).click();
  await answer(dialog(sam), product.map((q) => q.right));
  await dialog(sam).getByRole("button", { name: "Submit" }).click();
  await expect(dialog(sam).getByText("Passed!")).toBeVisible();
  await dialog(sam).getByRole("button", { name: "Close", exact: true }).first().click();
  const final = await key({ scope: "final" });
  await sam.getByRole("button", { name: "Start exam" }).click();
  await answer(dialog(sam), final.map((q, k) => (k === 0 ? q.wrong : q.right)));
  await dialog(sam).getByRole("button", { name: "Submit" }).click();
  await expect(dialog(sam).getByText(/correct · pass mark/)).toBeVisible();
  await dialog(sam).getByRole("button", { name: "Close", exact: true }).first().click();
  await sam.getByRole("button", { name: "Review answers" }).first().click();
  await expect(dialog(sam).getByText("Your answer:").first()).toBeVisible();
  await dialog(sam).getByRole("button", { name: "Close", exact: true }).first().click();

  // ── Employee: practicals
  const notes = "Took permission, hooked on expiry loss, asked about counters and daily bills, handled the price objection with plan fit and the free trial, no discount promised, booked a demo with the partner.";
  await field(sam, /^Role-play scenario/).selectOption({ label: `Hospital pharmacy buyer ${tag}` });
  await field(sam, /^After the call/).fill(notes);
  await sam.getByRole("button", { name: "Submit for scoring" }).click();
  await toast(sam, "Submitted. Your trainer will score it.");
  await sam.getByRole("button", { name: /Product demonstration \(20\)/ }).click();
  await field(sam, /^After the call/).fill("Said it was demo data; dashboard, salt search, FEFO, GRN, F9 billing with hold and split, credit reminder, reports for the CA; ended with the trial.");
  await sam.getByRole("button", { name: "Submit for scoring" }).click();
  await toast(sam, "Submitted. Your trainer will score it.");

  // ── Trainer: a failed demo, a retake, the mock call, attendance, send back, reopen, recommend
  const tr = await signIn(browser, P.trainer);
  await expect(tr.getByRole("link", { name: "Trainer Desk" })).toBeVisible();
  await tr.goto("/staff/hrms/trdesk");
  const score = async (kind: RegExp, values: "low" | "high", feedback: string) => {
    await tr.locator("li").filter({ hasText: kind }).getByRole("button", { name: "Score" }).first().click();
    const ranges = dialog(tr).locator("input[type=range]");
    for (let k = 0; k < await ranges.count(); k++) { const r = ranges.nth(k); await r.fill(values === "low" ? "1" : (await r.getAttribute("max"))!); }
    await field(dialog(tr), /^Feedback/).fill(feedback);
    await dialog(tr).getByRole("button", { name: "Save score" }).click();
    await toast(tr, "Score saved and shared with the employee.");
  };
  await score(/Product demonstration/, "low", "Rushed the flow; slow down and end with a clear next step.");
  await sam.goto("/staff/hrms/training?tab=assess");
  await sam.getByRole("button", { name: /Product demonstration \(20\)/ }).click();
  await expect(sam.getByText(/Rushed the flow/)).toBeVisible();
  await field(sam, /^After the call/).fill("Retake: calm flow from dashboard to reports, matched features to the owner's expiry problem, accurate claims, booked the trial for Monday.");
  await sam.getByRole("button", { name: "Submit for scoring" }).click();
  await toast(sam, "Submitted. Your trainer will score it.");
  await tr.reload();
  await score(/Product demonstration #2/, "high", "Much better: clear flow, honest claims and a next step.");
  await score(/Mock sales call/, "high", "Strong opening, good discovery, calm objection handling.");
  await tr.locator("tr").filter({ hasText: P.sam.name }).getByRole("button", { name: "Open" }).click();
  await dialog(tr).getByRole("button", { name: "Present" }).click();
  await toast(tr, "Attendance saved.");
  await field(dialog(tr), /^Trainer feedback/).fill("Needs one more look at GST wording.");
  await dialog(tr).getByRole("button", { name: "Not ready" }).click();
  await toast(tr, /employee sees your feedback/);
  await dialog(tr).getByRole("button", { name: "Reopen" }).click();
  await toast(tr, "Reopened.");
  await field(dialog(tr), /^Trainer feedback/).fill("Ready for the field.");
  await dialog(tr).getByRole("button", { name: "Recommend for certificate" }).click();
  await toast(tr, "Recommended for certification.");

  // ── HR: approval issues the certificate; PDF, public verification, report, extra attempt, move, revoke
  await hr.goto("/staff/hrms/academy");
  await hr.getByRole("button", { name: "Approve & issue" }).click();
  await toast(hr, /Certificate MS-STA-\d{4}-\d{4} issued\./);
  const cert = await db().trCertificate.findFirstOrThrow({ where: { assignmentId: a.id } });

  await sam.goto("/staff/hrms/training?tab=cert");
  await expect(sam.getByText("Congratulations, you are certified!")).toBeVisible();
  const pdf = await sam.request.get(await sam.getByRole("link", { name: "Download PDF" }).getAttribute("href") as string);
  expect(pdf.status()).toBe(200);
  expect(pdf.headers()["content-type"]).toBe("application/pdf");
  expect((await pdf.body()).subarray(0, 5).toString()).toBe("%PDF-");
  expect((await om.request.get(`/staff/hrms/training/certificate/${cert.id}`)).status()).toBe(404);
  const priya = await signIn(browser, P.priya);
  expect((await priya.request.get(`/staff/hrms/training/certificate/${cert.id}`)).status()).toBe(404);
  const pub = await request.get(`/certificate/verify/${cert.verifyCode}`);
  expect(await pub.text()).toContain("Valid Medoro certificate");

  await hr.getByRole("button", { name: "Training Reports" }).click();
  const [dl] = await Promise.all([hr.waitForEvent("download"), hr.getByRole("button", { name: /Download employee-wise report/ }).click()]);
  const csv = readFileSync(await dl.path() as string, "utf8");
  expect(csv).toContain(P.sam.name);
  expect(csv).toContain(cert.certNo);

  await hr.getByRole("button", { name: "Employees", exact: true }).click();
  await hr.locator("tr").filter({ hasText: P.priya.name }).getByRole("button", { name: "Open" }).click();
  await dialog(hr).getByRole("button", { name: "Allow one more attempt" }).click();
  await toast(hr, "One more attempt allowed.");
  await dialog(hr).getByLabel("Move to batch").selectOption({ label: `Batch B ${tag}` });
  await dialog(hr).getByRole("button", { name: "Move", exact: true }).click();
  await toast(hr, "Moved.");
  await dialog(hr).getByRole("button", { name: "Close", exact: true }).first().click();

  await hr.getByRole("button", { name: "Certificate Management" }).click();
  const certRow = hr.locator("tr").filter({ hasText: cert.certNo });
  await certRow.getByPlaceholder("Reason to revoke").fill("Issued to the wrong batch in this test.");
  await certRow.getByRole("button", { name: "Revoke" }).click();
  await toast(hr, "Certificate revoked.");
  expect(await (await request.get(`/certificate/verify/${cert.verifyCode}`)).text()).toContain("This certificate has been revoked");

  // ── Phone width: no sideways scrolling on the learner's screens
  const phone = await signIn(browser, P.sam, { width: 390, height: 844 });
  for (const tab of ["overview", "schedule", "modules", "tour", "assess", "cert"]) {
    await phone.goto(`/staff/hrms/training?tab=${tab}`);
    await expect(phone.getByText(/Medoro Sales Training Academy/).first()).toBeVisible();
    expect(await phone.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  }
});
