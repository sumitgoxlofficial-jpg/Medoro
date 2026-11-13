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
4. Pay day: HR or Finance processes **Payroll** once the pay period has ended; employees get a payslip (printable as PDF).
5. Leaving: HR opens **Record exit** on the employee and enters the last working day. Today or earlier deactivates them at
   once (sessions end immediately). A later day is a notice period: they keep working and are deactivated the day after it
   (the exit can be cancelled until then). That month's payslip is the **final settlement**: pay up to the last day, unused
   privilege leave paid at a day's basic (monthly basic ÷ 26), and gratuity after five years (15 days' basic per year of
   service). The settlement is an estimate; have a CA confirm it.

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
* **Me**: **ID card** (My profile, printable), **Customize home** (hide sections; saved in the browser), **night mode** (moon button; saved in the browser).
* Printing: payslips, invoices, offer letters and the ID card print only the document (Print / save as PDF).

## Aadhaar and PAN verification (KYC)

Every employee must give their **Aadhaar and PAN** with proof before they can use the HRMS (a fourth step after *Your details*, for new joiners and for everyone already here at their next sign-in). They tick a consent box, then:

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

## Not built (in the design, not in Medoro yet)

Built-in voice/video calls and screen sharing (Team Chat uses a Google Meet link instead), AI meeting minutes and AI candidate screening, Wins / Culture OS /
Non-Negotiables (these three are blank in the design itself). Ally answers from HR records; it does not read uploaded documents.

## Rules the code enforces

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
