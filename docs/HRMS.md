# Medoro HRMS

The team workspace for Medoro's own people, at **`/staff/hrms`**. Everyone signs in at **`/staff/employee`** with an
**employee ID (or official email) and password**. Employees have no Google sign-in; HR creates every profile.

## Who sees what

| Role | Menu |
|---|---|
| **Employee** | Home, My Tasks, Calendar, Attendance, Leave & Approvals (with reimbursement claims), Payslips, Work at Medoro (refer a candidate), Company policies, Support, My profile (with *Leaving Medoro*: resignation and exit interview) |
| **Sales** | Dashboard (target, follow-ups, leaderboard, incentive), Lead Tracker, My Leads, plus the employee screens |
| **HR Admin** | Everything an employee has, plus Employees, New Employee, Departments, Credentials, Onboarding, Exits, Policies, Team Attendance, Leave Management, Recruitment, Payroll, Performance, Assign Tasks, Projects, Leads, Reports, Ally Usage |
| **Finance** | Dashboard, Contacts, Sales & Invoices, Purchases & Expenses, Accounting, Products, Banking, GST and Reports, Payroll |
| **Super Admin** | Everything, plus Approvals, Roles & Permissions, Audit Logs, Settings |

A staff-console **super admin** is the HRMS super admin. HR and Finance are given by the super admin (or when creating a
profile). *Roles & Permissions* turns HRMS modules on or off per role; changes are audited.

## Sales Training Academy

A one-day training programme for the sales team: **My Sales Training** for assigned employees, **Trainer Desk** for a batch's
trainer and **Sales Academy** for HR (new *Sales Academy* module in Roles & Permissions). Official product tour, Hinglish lectures,
quizzes, practicals scored by the trainer, and a certificate after trainer and HR approval. The course installs itself and every
sales employee (Sales role or Sales department) is enrolled automatically; HR can turn auto-enrolment off in its Settings. See [SALES_ACADEMY.md](SALES_ACADEMY.md).

## Lifecycle of an employee

1. HR opens **New Employee**. The system makes `firstname.lastname@<STAFF_EMAIL_DOMAIN>`, the next employee ID
   (`MS-###`) and a 14-character temporary password (shown once, and emailed to the personal address when email is set up).
2. First sign-in: set your own password, fill in personal, emergency and bank details (account number and PAN are sealed
   with `HOST_KEY` and shown masked), accept the offer letter, appointment letter and NDA.
3. Daily: check in/out (late after the time in Settings), breaks, tasks, leave and claims.
4. Pay day: HR or Finance processes **Payroll** once the pay period has ended; employees get a payslip (printable as PDF).
5. Leaving: the employee resigns from *My profile* and HR accepts it under **Exits**, or HR opens **Record exit** on the employee and enters the last working day. Today or earlier deactivates them at
   once (sessions end immediately). A later day is a notice period: they keep working and are deactivated the day after it
   (the exit can be cancelled until then). That month's payslip is the **final settlement**: pay up to the last day, unused
   privilege leave paid at a day's basic (monthly basic ÷ 26), and gratuity after five years (15 days' basic per year of
   service). The settlement is an estimate; have a CA confirm it.

## Company policies (handbook)

* **Policies** (HR, *Employees* module): publish a policy (title, category, text: a blank line starts a paragraph, "- " starts
  a bullet), mark it *mandatory* (everyone must acknowledge) or *for information*. Everyone is notified. HR sees, per policy,
  who has and hasn't acknowledged the current version, can **Remind** the ones who haven't, **Edit** and **Archive** / restore.
  An edit can be ticked as *an important change*: the version goes up and everyone must acknowledge it again (they are told).
  Small edits (typos) keep existing acknowledgements.
* **Company policies** (everyone, COMPANY menu): read each policy and press *I have read and accept*; the page shows how many are
  still to acknowledge. Acknowledgements are kept per version, with the time.

## Exits: resignation, exit interview and clearance

* **Resign** (everyone except the super admin: *My profile → Leaving Medoro*). The employee gives a reason and the last working day
  they would like (the full 30-day notice period is suggested; a shorter date is flagged to HR). HR and their reporting manager are
  told. While HR hasn't decided, the employee can **withdraw** it.
* **Exits** (HR, *Employees* module): resignations waiting, and everyone leaving or who left in the last 30 days.
  * **Accept** confirms or changes the last working day and records the exit exactly like *Employees → Record exit* (notice period,
    final settlement in that month's payroll, deactivated the day after). **Decline** needs a reason; the employee is told.
  * **Clearance checklist** per person: work handed over, assets returned (the card also counts items still issued in the asset
    register), ID/access card, system access removed, dues settled, final settlement checked. Each tick records who did it.
    Exits HR records directly (without a resignation) get the same checklist.
  * **Exit interview**: once a last working day is recorded, the employee sees the form on *My profile* (main reason, what they liked,
    what to improve, a 1–5 rating of their manager, would they recommend Medoro, would they come back). It can be sent once, before
    the last day. Only HR (and the person) can read the answers; the manager cannot.
  * Cancelling an exit (*Employees → Cancel exit / Reactivate*) closes its resignation and checklist.
## My Team (reporting managers and team leaders)

Anyone who has at least one active direct report ("Reports to" on their profile), in any role, gets **My Team** in the TEAM
menu. It shows only their direct reports and only work information (no pay, bank, KYC or chat):
* **Today**: each person's status (present, late, checked out, on leave, day off, not in yet) with check-in and check-out times.
* **Leave requests from your team**: approve or reject (the same decision HR can make; whoever acts first decides).
* **Out in the next 2 weeks**, **open tasks** (overdue flagged) and **this month** per person: days checked in, late days, tasks
  done, on-time %, open and overdue tasks.
* **Give a task** to a direct report. A manager can assign plain tasks to their own reports without the *Tasks & projects*
  module; tasks in a project, or for anyone else, still need that module.

## More screens

* **Assets** (everyone: *Assets* under Me; HR: the register too). HR adds equipment (tags `MS-AST-0001`…), issues it to an employee and takes it back.
  An employee sees their items and can **Report issue**: that raises an HR support ticket and marks the item *In repair*.
* **My Projects** (everyone). The projects you are a member of, your tasks in each (tick done, move stage), team and progress.
* **Projects** (HR, *Tasks & projects*): views **Dashboard, Board, Timeline, List, Sprints, Risks**. Timeline draws a bar per task from when it was
  created to its due date. Sprints have dates and a goal; tasks join a sprint of their own project (List view). Risks have a level, owner, mitigation and status.
* **Accounts**: **Sales CRM & Leads** (deals), **Marketing CRM** (campaigns), **Workflows & Automations**, plus Proforma, Delivery challans, Vendors and Vendor leads registers.
  Workflows are only listed if they really run: *Mark overdue invoices* (sent invoices past their due date become Overdue and Accounts is told, whenever an
  accounts screen opens) and *Post the salary journal* (processing payroll adds one journal entry for the month's net pay). Each can be switched off.
* **KYC & certificates** (My profile). The employee uploads identity and address proof, certificates, a relieving letter or a
  cancelled cheque (PDF, JPG, PNG). HR opens them from **Employees → Documents**, marks each verified or removes it. Files open
  only for their owner and people with the Employees module; HR opening one is written to Audit Logs. A verified document can
  only be removed by HR. Aadhaar and PAN numbers are collected in the KYC step (see *Aadhaar and PAN verification*).
  **Expiry dates:** a document can have an *Expires on* date (passport, visa, contract, licence…), set when uploading or later
  in the Expires column by the employee or HR (a past date is refused). The employee and HR get a notification 30 days and
  7 days before and on the day it expires (each once per date; a new date starts again; people who have left are skipped).
  HR's dashboard lists documents of active people that have expired or expire within 30 days. The reminders run with the
  scheduled jobs (`/api/cron/tick`, or the in-process scheduler on self-hosted installs).
* **Promotions** (HR, **Employees → Promote**). HR enters the new designation, department, reporting manager, annual CTC (with quick +10/15/20/30%
  buttons), the roles and responsibilities of the new role (one per line) and an effective date. The employee's profile changes on that date
  (at once when it is today or earlier; otherwise with the daily housekeeping, and always before payroll runs), a CTC change is kept in salary
  revisions, and a **Letter of Promotion** (before/after at a glance, numbered responsibilities, revised Annexure A when pay changes, an
  acknowledgement block) goes to the employee's **My documents** with a notification, and by email as a PDF if ticked. The letter keeps the terms
  it was written with even if the profile is edited later. A promotion that hasn't taken effect can be cancelled, which withdraws its letter.
  The current responsibilities show on the employee's profile, and HR can also edit them under **Edit**.
* **Me**: **ID card** (My profile, printable), **Customize home** (hide sections; saved in the browser), **night mode** (moon button; saved in the browser).
* Printing: payslips, invoices, offer letters and the ID card print only the document (Print / save as PDF).

## Aadhaar and PAN verification (KYC)

Every employee must give their **Aadhaar and PAN** with proof before they can use the HRMS (the **super admin** is not asked: they go straight in) (a fourth step after *Your details*, for new joiners and for everyone already here at their next sign-in). They tick a consent box, then:

1. **Numbers.** The Aadhaar number is checked for typing mistakes (12 digits and its check digit). Both numbers are **sealed with `HOST_KEY`** and shown masked (`XXXX XXXX 1234`, `AB•••••34K`). Changing the Aadhaar number clears an earlier verification.
2. **Aadhaar proof.** **Verify with DigiLocker** (when set up): the employee signs in on DigiLocker with their Aadhaar OTP (Medoro never sees it), allows Medoro to read their e-Aadhaar once, and Medoro checks the **last four digits, name and date of birth** against what they entered and what is in Medoro. A match verifies the Aadhaar automatically. A mismatch changes nothing and says why; the employee uploads the card instead. Nothing from DigiLocker is kept.
3. **PAN proof** (and the Aadhaar when DigiLocker isn't used): the employee uploads the card (PDF, JPG, PNG). HR opens **Employees → Documents**, can **show the full numbers to compare with the cards** (each opening is audited), and marks each card verified.

The directory shows each person as **Verified**, **Check** (submitted, waiting for HR) or **Missing**. By default a person gets in once they have *submitted*; under **Settings** you can turn on *Keep people out until their Aadhaar and PAN are verified*, and they then wait for HR (or a DigiLocker match, then the PAN card check).

**DigiLocker set-up** needs a DigiLocker partner (requester) account from MeitY / API Setu: set `DIGILOCKER_CLIENT_ID`, `DIGILOCKER_CLIENT_SECRET` and `DIGILOCKER_BASE` (the host DigiLocker gives you: production, or their sandbox while testing; Medoro does not guess it), and register `<APP_URL>/staff/hrms/digilocker/callback` as the redirect address. Check the endpoints Medoro calls (`/public/oauth2/1/authorize`, `/1/token`, `/3/xml/eaadhaar`) against the documentation DigiLocker gives your account, and test in their sandbox before relying on it. Until it is set up the button is hidden and employees upload the Aadhaar card for HR.

Limits: Medoro matches the e-Aadhaar DigiLocker returns over TLS; it does not check UIDAI's digital signature on the XML, and PAN is checked by a person against the card (no NSDL/Protean PAN lookup). Aadhaar and PAN are personal data under India's DPDP Act, and the rules on collecting and storing Aadhaar numbers are strict: have a lawyer confirm the consent wording, who may open the numbers, and how long you keep them. Medoro keeps the sealed number only for HR's comparison; it is never shown in full on a payslip, list or export.

## Selfie check-in and idle-time monitoring

Both are **off** until the super admin switches them on under **Settings → Workforce policy**. Tell your team before you do: employees also see a notice on their Attendance screen.

* **Selfie check-in.** A photo from the camera is needed to check in and out; no photo, no check-in (HR can still mark attendance). The picture is a record for HR to look at:
  nothing is analysed or matched. It is a small JPEG, **sealed with `HOST_KEY`**, opened only for the employee and people with the Attendance module through
  `/staff/hrms/selfie/<id>` (never cached), and **deleted after 30 days**. HR sees them in Team Attendance; the employee sees their own in the day popup.
* **Idle-time monitoring.** Counts inactivity (mouse, keyboard, scroll, touch) **in the HRMS browser tab only**, while the employee is checked in and not on a break. After the set
  minutes (1–30) the person is asked "Still working?"; with no answer in 2 minutes the stretch is recorded as idle from their last activity until they come back. A hidden tab
  isn't counted (work in another window is invisible to us). **Nothing typed, no screenshots, no other apps.** Breaks and check-out end an idle stretch. Records are deleted after 90 days.
  HR sees idle minutes today (and "idle now") in Team Attendance.
* Data protection: these are personal data under India's DPDP Act. Use them only for attendance, tell staff what is recorded and for how long (this page and the notice on Attendance say it), and keep the retention above.

## Team Chat

`/staff/hrms/chat`: one-to-one messages, groups (up to 100 people), photos (JPEG/PNG/WebP, 2 MB), unread counts, read ticks and a
"📹 Meet" button that creates a Google Meet link in the sender's own Google Calendar and posts it in the chat (needs the sender to have
connected Google Calendar).

* **Live-ness.** The screen polls `/staff/hrms/chat/poll` every 2.5 s while the tab is visible (15 s in the background). Messages appear
  within a few seconds. There is no always-open connection, because Vercel doesn't keep them; about 100 people online is roughly 40
  small indexed requests a second.
* **Privacy.** Every message and picture is sealed with `HOST_KEY` before it is stored. Only the people in a conversation can read it:
  HR and Finance cannot. The super admin can open any conversation from **Chat review**; each opening is written to Audit Logs (who,
  which chat, which people, never the text), and the chat screen tells staff this. It is encryption at rest with an audited admin key,
  **not** end-to-end encryption: the server must be able to open messages for delivery, review and backups.
* People added to a group later don't see earlier messages. You can delete your own messages. Messages are kept until a retention
  rule is added; they are included in database backups (still sealed).
* Not built: typing indicators, online status, voice notes, Google Drive backups of chats.

## WhatsApp alerts

* HRMS alerts (leave, claims, tasks, reviews and the rest that appear under the bell) can also go to WhatsApp. They are sent from the
  company's WhatsApp Business number through the official Cloud API. It is the same number connected once in **Growth → Integrations**. No
  WhatsApp Web automation is used.
* One-time setup:
  1. In WhatsApp Manager, create a **Utility** template with one body variable, for example `Medoro HRMS: {{1}}`, and wait until Meta
     approves it.
  2. In **Settings → WhatsApp alerts** (super admin), enter its name and language code and switch alerts on.
  3. Use **Send a test to my phone** to check it end to end. A wrong template name shows WhatsApp's error at once.
* Each employee chooses on **My Profile** ("Send my HR alerts to … on WhatsApp"). It is off until they switch it on, and the time of each
  change is kept as their consent record. They need a valid Indian mobile number on their profile.
* The in-app notification is always written. The WhatsApp copy is queued in `HrWaMessage` and sent straight after the action.
  If sending fails, the scheduler retries it (`/api/cron/minute` or the self-hosted tick), up to 3 tries. Team Chat messages are not sent to WhatsApp.

## Performance appraisals

* Someone with the **reports** module opens a review cycle on **Appraisals** (name, period, self-assessment and manager-review due
  dates). Only one cycle can be open at a time. Every active employee except the Super Admin gets a review and is told.
* Each step happens on **My Review**. The employee rates themselves 1–5 and writes their achievements, challenges and goals. Their reporting
  manager then rates them and writes what went well and what to improve. Employees with no manager go straight to HR.
* HR (reports module) sets the final rating and an optional note. Nobody can finalise their own review. Only the Super Admin can finalise
  one that is still waiting for the manager. The employee sees the manager's and HR's assessment only once it is final, then
  acknowledges it.
* The review shows facts from the period next to the form: tasks done, the share done on time, open overdue tasks, days present and late days.
  HR can export the cycle as CSV and close it.

## Training videos (staff only)

* **Training Videos** (COMPANY menu, everyone): 20 short Hinglish how-to videos for the HRMS, recorded with "(Demo)" staff.
  Real people are blurred.
* Each person sees only the videos for what their role can open: payroll, finance, recruitment, leads and HR videos need
  that module. The super admin, roles and dashboard-comparison videos are for the super admin only.
* The sign-in page links to them (`/staff/employee?next=videos` opens the videos right after signing in).
* The videos are in a **private** Supabase Storage bucket, `hrms-videos`, in the production project. The bucket is never public,
  so there are no files in this repository (it is public). When the screen opens, it calls `POST /staff/hrms/videos/links`.
  medoro.in then asks the `hrms-videos` Edge Function for signed links, valid for 4 hours, to only that person's videos
  (`src/staff/hrms/video-links.ts`). The function and medoro.in share a secret that Postgres generated and keeps in
  `HrSetting` (key `videoSecret`), so it is in no code, env var or chat. Without the secret (preview and dev), the screen
  says the videos can't be opened.
* To add or replace a video: encode it as H.264 (`-crf 30 -tune stillimage`, `+faststart`; at most 50 MB) with a 640px JPEG
  thumbnail. Upload both to `files/<slug>.mp4` and `thumbs/<slug>.jpg` in the bucket (the dashboard, or the function's
  `upload` action), then add it to `HR_VIDEOS` in `src/staff/hrms/video-catalog.ts` with who may watch it.

## Not built (in the design, not in Medoro yet)

Built-in voice/video calls and screen sharing (Team Chat uses a Google Meet link instead), AI meeting minutes and AI candidate screening, Wins / Culture OS /
Non-Negotiables (these three are blank in the design itself). Ally answers from HR records; it does not read uploaded documents.

## Rules the code enforces

* **First sign-in is enforced on the server.** Until a person has set their own password, filled in their details,
  given Aadhaar and PAN (or skipped) and accepted the joining documents, the server runs only the actions of the step
  they are on, sends no screen data, and every file route (documents, payslips, chat pictures, selfies…) answers as if
  signed out. A temporary or one-time password opens nothing but the password step.
* **Nobody acts on their own records** (the super admin excepted): no editing your own employment record (pay, tax,
  role, manager), changing your own leave balance or loss-of-pay days, confirming your own bank account, approving your
  own leave, claim or correction, verifying your own document or promoting yourself. Loss-of-pay changes made in a
  payroll run are written to Audit Logs.
* **Uploads are checked by content.** Documents and claim bills must really be PDF, JPG, PNG or WebP files.
* **Opening full Aadhaar and PAN numbers** is limited to 30 per HR person per hour; each opening and each refusal is audited.
* **Payslips and salary revisions are append-only** in the database (as is the audit log): they can't be edited or deleted.
* **Attendance.** Check-in is on by default. A working day in the past with no check-in, no leave and no approved
  correction is *absent* and counts as loss of pay in payroll (HR can override LOP days per person before processing).
  Weekly offs (Saturday and Sunday unless changed in Settings → *Weekly days off*) and holidays never count. Corrections go to HR.
  HR can give a person their own **shift start** (Edit employee); they are late after that time instead of the company time.
  A day someone forgot to check out of is closed the next day at a full working day after check-in, with a note.
  Days before a person's HRMS profile was created are never absent ("No record"), so adding existing staff doesn't dock their pay.
* **Leave.** Yearly policy per type (Settings), plus extra days HR grants. In the year someone joins they get the share
  from their joining month (joined in October: 3/12 of each type, rounded). Weekends/holidays inside a request are not
  counted; requests can't overlap; you can't approve your own leave (someone else, or the super admin, must).
  A request can be **half a day** (one date; the person still checks in for the other half). **Unpaid leave** has no balance:
  each day is loss of pay in payroll. A request goes to HR **and the person's reporting manager** ("Reports to" on the profile);
  either can decide it. The manager sees *Team requests* on their own Leave screen. Unused **privilege leave carries forward**
  into the next year, up to the cap in Settings (default 30 days; 0 switches it off).
* **Claims.** Employee → HR review → super-admin final sign-off → paid with the next payroll (added to net pay, once).
  Bills are stored through the normal file storage (disk, database or Supabase) and open only for the owner, HR and the super admin.
* **Pay cycles.** A **new joiner is paid on a monthly cycle that starts on their joining day**: joined 13 Nov 2026, nothing is paid in November, the first salary is paid on **13 Dec 2026** for 13 Nov to 12 Dec, then on the 13th of every month (a day the month doesn't have, like the 31st in November, becomes its last day). HR sees the first salary date when creating the profile. People who were paid by calendar month before this keep it; HR can set a cycle day on *Edit employee* (0 = calendar month) until the person has been paid. When the due date is a weekly off or a holiday, the salary is paid on the **working day before** it (13 Dec 2026 is a Sunday, so that first salary is paid on Fri 11 Dec). A payslip is filed under the month it is **paid** in, and each person's payslip shows its own period and salary date. A period is processed once its last working day has come, and Process payroll pays the people who are ready; the rest stay in the list with the reason.
* **Salary goes only into the employee's own bank account.** Payroll won't process someone with no bank account and IFSC saved, or whose account holder name isn't theirs (initials count: *A Verma* is *Asha Verma*). For a joint account or a spelling difference, HR can press *It's their account* on the Payroll screen; changing the account, IFSC or holder name removes that confirmation. The bank transfer file lists each person's salary date and period.
* **Payroll.** Monthly from the annual CTC: basic 50%, HRA 40% of basic, rest special allowance. PF 12% of basic capped at
  ₹15,000, ESI 0.75% when monthly CTC ≤ ₹21,000, professional tax from Settings, TDS estimated on the new tax regime
  (₹75,000 standard deduction, nothing up to ₹12,00,000 taxable with marginal relief, 4% cess), sales incentive from won
  pharmacies. A processed month can't be processed again, so a month opens for processing on its
  last working day (before that the screen is a preview). Someone who leaves is paid up to their last working day, in that month. The bank transfer file opens account numbers and is audited.
  HR can put a person on the **old regime** with their accepted yearly deductions (Edit employee); TDS then uses the old slabs.
  TDS is an estimate: have a CA confirm it for people with other income.
  Downloads on the Payroll screen for a processed month: the **PF return** in EPFO's ECR text layout (people without a UAN are
  left out and named), the **ESI return** (both shares; add the ESI number on Edit employee), the payroll report (with the
  employer's PF and ESI) and the bank file. Employees download a **tax statement** for a financial year from Payslips (what a CA
  needs for Form 16; Form 16 itself is issued from TRACES). Every change of CTC is kept as a salary revision on the profile.
* **Leads.** Sales screens work on the same lead table and the same *won → logged sale and commission* path as the staff
  console pipeline. HR uploads a CSV (`store, owner, phone, city, plan, source`), assigns leads or auto-assigns them evenly,
  and sets each salesperson's monthly target and incentive (max 5%).
* **Accounts.** Contacts, quotes, invoices (GST: CGST+SGST in your state, IGST otherwise), receipts, orders, bills,
  journals, products and bank accounts are simple registers. Dashboards, P&L, ageing and the GST summary are computed
  from them and from payroll. Filing GSTR returns happens on the GST portal.
* **Ally.** Answers from the employee's own records. With a local model on this server (`AI_MODE=local`) the same facts
  are given to it to phrase the answer; HR data never goes to a remote provider.

## Google Calendar

Each employee can connect their own Google Calendar under **Calendar → Google Calendar → Connect**. Their Google events then
show in the HRMS month view, and a meeting scheduled in the HRMS can be added to Google Calendar with a **Google Meet link**
and email invitations (sent by Google to the attendees' official emails). Cancelling the meeting removes the Google event.

* Only the `calendar.events` scope is requested (read and create events; no contacts, no mail, no other calendars' settings).
  The refresh token is sealed with `HOST_KEY`; **Disconnect** revokes it at Google and forgets it.
* A Google problem never blocks the HRMS: meetings are still created, and the screen says what Google refused.
* One-time server setup, in the Google Cloud project of `GOOGLE_OAUTH_CLIENT_ID`: enable the **Google Calendar API**, add the
  scope `.../auth/calendar.events` to the OAuth consent screen, and add the redirect URI
  `<APP_URL>/staff/hrms/google/callback` (or set `GOOGLE_CALENDAR_REDIRECT_URI`) to the client's authorised redirect URIs.
  While the consent screen is in *Testing*, only listed test users can connect.

## Sign-in security

Argon2id passwords (12+ characters), lockout after 5 wrong tries for 15 minutes (per ID and per IP), one-time passwords
valid for one sign-in, forced change after a temporary or one-time password (other devices are signed out), 10-hour
sessions in the `/staff`-scoped `medoro_staff` cookie (`SameSite=Strict`). An HRMS session cannot open the staff console;
the only exception is sales employees, who see just their own leads and commission there. Staff-console super admins who
enabled an authenticator app also enter its code in the HRMS.

## Setup

To create (or reset) a super admin with a one-time password, run on the server: `node scripts/create-super-admin.mjs <email> <one-time-password> ["Full Name"] [mobile]`. The password works for one sign-in within 7 days and is then replaced. Never commit it.

Run `pnpm prisma migrate deploy`. The first super admin comes from `STAFF_BOOTSTRAP_EMAIL` (staff console sign-up). Set
`STAFF_EMAIL_DOMAIN` for official emails (default `medoro.in`) and `MAIL_PROVIDER`/`MAIL_FROM` if you want welcome and
one-time-password emails. Add holidays in **Calendar**, then review **Settings** (company details, late time, leave policy).

## Chat backup to the employee's own Google Drive

Team Chat ▸ ☁ lets each employee connect their **own** Google account. Medoro then keeps one encrypted copy of their conversations in Drive's hidden app folder (scope `drive.appdata`: Medoro sees only the file it made, and the employee sees nothing in their Drive). The file is sealed with `HOST_KEY`, so only this Medoro server can open it again. It backs up daily (the cron tick) and on "Back up now"; "Restore missing messages" puts back messages that are gone from the database (never changing or removing anything; messages deleted by their sender stay deleted). Pictures are not included. It uses the same Google OAuth client and redirect URI as Google Calendar: add the `drive.appdata` scope to the OAuth consent screen and make sure the Drive API is enabled.

## Careers page (`/careers`)
HR (Recruitment module) and the super admin post jobs from **Recruitment → + Post a job**: title, team, location, type, workplace (on-site / hybrid / remote), experience, salary (optional, shown publicly), skills, description, requirements and benefits. Each job goes live at `/careers/<slug>` with schema.org `JobPosting` data so Google for Jobs can list it. "Close job" takes it off the page.

Job seekers browse a two-pane job board (search, team / type / workplace filters) and use **Easy Apply**: sign in with **LinkedIn**, **Google** or an **email code** (a 6-digit code sent to their email: for Naukri users and anyone without LinkedIn or Google; no account or password is created), or apply without signing in; mobile, city, experience, LinkedIn profile, a PDF résumé and an optional note. Duplicate applications (same email, same job) are refused; applications are rate-limited per network. The applicant gets a "Thank you for your interest in the … role" email with an application reference straight away, HR gets a notification, and the candidate appears in **Applied** with source, résumé and LinkedIn link. Signed-in applicants see their status at `/careers/applications`, and their next application is filled in from the last one (mobile, city, experience, LinkedIn link) with the option to reuse the same résumé; the browser also remembers typed details. LinkedIn sign-in only shares name and email (work history and résumé need LinkedIn partner access), so the form points LinkedIn users to "Save to PDF" on their profile for a résumé.

**Share** on a job gives tracked links (`?src=linkedin`, `naukri`, `indeed`, `instahyre`, `internshala`, `whatsapp`) to paste into a post on those sites; anyone applying through a link is tagged with that source, and the pipeline can be filtered by source.

Setup: `MAIL_PROVIDER` for the thank-you email; `GOOGLE_OAUTH_CLIENT_ID/SECRET` for "Apply with Google"; `LINKEDIN_CLIENT_ID/SECRET` (LinkedIn app with "Sign In with LinkedIn using OpenID Connect", redirect `${APP_URL}/api/careers/linkedin/callback`) for "Apply with LinkedIn". Without them the page still works with email applications.

## AI HR Assistant

**AI HR Assistant** (HR, *Attendance & leave* module) and **AI conversations** (everyone). Off until the super admin
switches it on in AI HR Assistant → Settings. It notices a missing check-in 10 minutes after someone's shift start
(late), 30 minutes after with no approved leave (absent), and a missing check-out 15 minutes after the shift end
(thresholds configurable); holidays, weekly offs and approved leave never trigger it. A manager or HR can also ask about
overtime. The employee gets a notification, opens the conversation and answers by voice or text; the assistant says it
is an AI, asks one thing at a time, and records what they said, what it inferred and what it recommends. HR sees
every outcome and approves or rejects proposals (leave drafts, work-from-home, follow-ups) under Escalations; nothing
changes attendance, leave, pay or overtime by itself. "Call mat karo" stops AI conversations for that person; "HR se
baat karni hai" hands over to HR; harassment, accidents and emergencies go to HR as urgent. Transcripts are sealed and
deleted after the retention period (default 90 days); audio is never stored. Voice is free and needs no server: speech
is recognised in the employee's browser (Whisper, downloaded once) and replies are spoken by the device's own Hindi voice;
the self-hosted AI service (`ai-service/`) is an optional alternative. Typing always works. See [ai-hr-assistant](ai-hr-assistant/README.md).
