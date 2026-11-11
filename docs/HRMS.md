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
