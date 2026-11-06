# Employees, roles and distribution

## Employee sign-in with Google (sales employees)

Sales employees have their own sign-in page: **`/staff/employee`** (also linked from the Medoro team sign-in as
"Sales employee? Sign in with Google").

1. The employee taps **Continue with Google** and picks their Google account (any Google-verified email, e.g. Gmail).
2. First time: they enter full name, mobile and area/team, accept the employee terms and tap **Send for approval**.
   This creates a staff profile with role *Sales* in status *pending*. No password, no authenticator. Super admins get an
   email when email is configured.
3. A super admin opens **Growth intelligence → My employees → Waiting for approval**, checks the person, optionally picks
   a team, and taps **Approve** (or **Reject**). Approval activates the profile *and* gives it the Sales employee Growth
   role in one step.
4. From then on the employee taps **Continue with Google** on `/staff/employee` and lands on **My assigned leads**.

Rules: only staff with role *Sales* can use this page; admins, managers, analysts and customer care keep the Medoro team
sign-in (email + password + authenticator), because they can see and export many leads. A Google account already used
by a reference partner can't be reused; a profile linked to one Google account can't be opened with another; rejected
and deactivated profiles can't sign in; sign-ups are rate limited per network. An existing password-based sales profile
can link Google the first time it uses this page (Google has verified the same email). Deactivating an employee under
Employees ends their sessions as before.

It uses the existing "Sign in with Google" setup (`GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, redirect URI
`<APP_URL>/api/auth/google/callback`): no new configuration. Without it the page says Google sign-in isn't set up.

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
