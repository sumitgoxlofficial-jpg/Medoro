# Employees, roles and distribution

## Employee sign-in (Medoro HRMS)

Every Medoro employee, including sales employees, signs in on **`/staff/employee`** with their **employee ID or official
email and a password**. There is no Google sign-in for employees and no self sign-up: **HR creates every profile**
(HRMS → New Employee). See [docs/HRMS.md](../HRMS.md).

* The password HR hands over is temporary: the first sign-in forces a new one, then personal and bank details, then the
  joining documents.
* A forgotten password is replaced by a one-time password from HR (HRMS → Credentials) or, when this server can send
  email, one emailed to the employee. It works once.
* Sales employees get a profile with the Sales role and are given a Growth role under **Growth → My employees**.
  They can still open their own lead tools from the account menu.
* Deactivating an employee ends their sessions at once.

## Identities

Growth employees are the existing staff console profiles. A super admin creates or approves them under **Employees**
(existing flow: work email, invite link, password, mandatory authenticator). Under **Growth → My employees** a super admin
then gives a profile a Growth role and team. No second account is created. Reference partners (outside MRs) can never be
given a Growth role.

| Role | Who | Can |
|---|---|---|
| Super admin | staff role `super_admin` | Everything, including integrations, campaign approval, compliance (lift DNC, erase, retention), settings, job retries |
| Marketing manager | GrowthMember `manager` | Leads that are unassigned or with their team; import, discover, verify, merge; assign/distribute within their team; targets; performance; campaigns (not approval); messages; compliance view |
| Sales employee | GrowthMember `sales` | Only leads actively assigned to them: call, report, notes, follow-ups, demos, conversions, consent, messages, AI help |
| Analyst | GrowthMember `analyst` | Dashboards, analytics and performance (aggregates only; no lead lists) |

A team has one manager; the manager's scope is the active members of teams they manage.

## Lead Distribution Centre

* Select leads by state, district, city, PIN, minimum score, or pick them one by one in All pharmacy leads (checkboxes).
* Assign to one employee, **distribute equally** (contiguous blocks by state/district/PIN, e.g. 300 → 100/100/100; the
  first employees take the remainder) or **balance by load**.
* Territories (state, district or PIN per employee): "Assign by territory" gives unassigned leads to the most specific
  match, splitting equally where several employees share a territory.
* Deadlines per assignment; "past deadline" and "never called" counts per employee.
* Reassign (opt-in per action), withdraw (with reason), and move every lead of an inactive or removed employee.
* One active owner per lead (database-enforced). Reassignment ends the old assignment, keeps every call report and note,
  moves open follow-ups to the new owner and writes assignment history.
* DNC, erased and merged leads are skipped with a reason.

## Targets and performance

Daily and weekly targets (calls, connected, conversions) apply from a date. Employee performance shows, per employee and
date range: assigned, dialer opens, reported calls, connected, interested, demos booked/done, trials, conversions,
revenue, pending/overdue follow-ups, today vs daily target, this week vs weekly target, and this month's conversion rate
(conversions ÷ distinct leads connected). Dialer opens are never counted as calls.

## Follow-ups

Today / overdue / upcoming / done lists and a month calendar (follow-ups and demos). Reporting a call closes the
employee's open follow-ups for the lead and opens the next one if a date is given. A follow-up overdue by 24 hours is
escalated once (timeline entry + event; the team manager, or super admins, get an email when email is configured).
