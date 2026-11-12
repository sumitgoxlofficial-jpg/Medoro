# Medoro HRMS

The team workspace for Medoro's own people, at **`/staff/hrms`**. Everyone signs in at **`/staff/employee`** with an
**employee ID (or official email) and password**. Employees have no Google sign-in; HR creates every profile.

## Who sees what

| Role | Menu |
|---|---|
| **Employee** | Home, My Tasks, Calendar, Attendance, Leave & Approvals (with reimbursement claims), Payslips, Work at Medoro (refer a candidate), Support, My profile |
| **Sales** | Dashboard (target, follow-ups, leaderboard, incentive), Lead Tracker, My Leads, plus the employee screens |
| **HR Admin** | Everything an employee has, plus Employees, New Employee, Departments, Credentials, Onboarding, Team Attendance, Leave Management, Recruitment, Payroll, Performance, Assign Tasks, Projects, Leads, Reports, Ally Usage |
| **Finance** | Dashboard, Contacts, Sales & Invoices, Purchases & Expenses, Accounting, Products, Banking, GST and Reports, Payroll |
| **Super Admin** | Everything, plus Approvals, Roles & Permissions, Audit Logs, Settings |

A staff-console **super admin** is the HRMS super admin. HR and Finance are given by the super admin (or when creating a
profile). *Roles & Permissions* turns HRMS modules on or off per role; changes are audited.

## Lifecycle of an employee

1. HR opens **New Employee**. The system makes `firstname.lastname@<STAFF_EMAIL_DOMAIN>`, the next employee ID
   (`MS-###`) and a 14-character temporary password (shown once, and emailed to the personal address when email is set up).
2. First sign-in: set your own password, fill in personal, emergency and bank details (account number and PAN are sealed
   with `HOST_KEY` and shown masked), accept the offer letter, appointment letter and NDA.
3. Daily: check in/out (late after the time in Settings), breaks, tasks, leave and claims.
4. Month end: HR or Finance processes **Payroll**; employees get a payslip (printable as PDF).
5. Leaving: HR deactivates the profile. Sessions end immediately.

## More screens

* **Assets** (everyone: *Assets* under Me; HR: the register too). HR adds equipment (tags `MS-AST-0001`…), issues it to an employee and takes it back.
  An employee sees their items and can **Report issue**: that raises an HR support ticket and marks the item *In repair*.
* **My Projects** (everyone). The projects you are a member of, your tasks in each (tick done, move stage), team and progress.
* **Projects** (HR, *Tasks & projects*): views **Dashboard, Board, Timeline, List, Sprints, Risks**. Timeline draws a bar per task from when it was
  created to its due date. Sprints have dates and a goal; tasks join a sprint of their own project (List view). Risks have a level, owner, mitigation and status.
* **Accounts**: **Sales CRM & Leads** (deals), **Marketing CRM** (campaigns), **Workflows & Automations**, plus Proforma, Delivery challans, Vendors and Vendor leads registers.
  Workflows are only listed if they really run: *Mark overdue invoices* (sent invoices past their due date become Overdue and Accounts is told, whenever an
  accounts screen opens) and *Post the salary journal* (processing payroll adds one journal entry for the month's net pay). Each can be switched off.
* **Me**: **ID card** (My profile, printable), **Customize home** (hide sections; saved in the browser), **night mode** (moon button; saved in the browser).
* Printing: payslips, invoices, offer letters and the ID card print only the document (Print / save as PDF).

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

## Not built (in the design, not in Medoro yet)

Built-in voice/video calls and screen sharing (Team Chat uses a Google Meet link instead), AI meeting minutes and AI candidate screening, Wins / Culture OS /
Non-Negotiables (these three are blank in the design itself). Ally answers from HR records; it does not read uploaded documents.

## Rules the code enforces

* **Attendance.** Check-in is on by default. A working day in the past with no check-in, no leave and no approved
  correction is *absent* and counts as loss of pay in payroll (HR can override LOP days per person before processing).
  Weekends and holidays never count. Corrections go to HR.
* **Leave.** Yearly policy per type (Settings), plus extra days HR grants. Weekends/holidays inside a request are not
  counted; requests can't overlap; you can't approve your own leave (someone else, or the super admin, must).
* **Claims.** Employee → HR review → super-admin final sign-off → paid with the next payroll (added to net pay, once).
  Bills are stored through the normal file storage (disk, database or Supabase) and open only for the owner, HR and the super admin.
* **Payroll.** Monthly from the annual CTC: basic 50%, HRA 40% of basic, rest special allowance. PF 12% of basic capped at
  ₹15,000, ESI 0.75% when monthly CTC ≤ ₹21,000, professional tax from Settings, TDS estimated on the new tax regime
  (₹75,000 standard deduction, nothing up to ₹12,00,000 taxable with marginal relief, 4% cess), sales incentive from won
  pharmacies. A processed month can't be processed again. The bank transfer file opens account numbers and is audited.
  TDS is an estimate: have a CA confirm it for people with other income or the old regime.
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
