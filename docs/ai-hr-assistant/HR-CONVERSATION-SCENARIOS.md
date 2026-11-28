# HR conversation scenarios

Library version **2027.01.2**: **1,060 scenarios in 106 categories**, every one run through the real conversation
engine and checked automatically. Data: `src/staff/hrms/ai-hr/scenarios/lib-1.ts` … `lib-6.ts` (structured data, not a
prompt). Results: [SCENARIO_REPORT.md](SCENARIO_REPORT.md) (regenerated, **1,060 / 1,060 pass**).

```bash
pnpm tsx scripts/ai-hr/evaluate.ts            # run all, rewrite SCENARIO_REPORT.md + scenario-results.json
pnpm tsx scripts/ai-hr/show.ts traffic-03      # one conversation, turn by turn, with the intents found
pnpm vitest run src/staff/hrms/ai-hr           # unit tests incl. "every scenario passes"
```

## Format

Each category (`cat(id, name, callReason, objective, escalation, [two Devanagari examples], items)`) holds ten
distinct situations. Each item is `[what the employee says, English rendering, expected outcome]`; turns are separated
by `||`, an empty turn is silence. Every scenario therefore has:

| Field (brief) | Where |
|---|---|
| Scenario ID | `<category>-NN` (e.g. `informal_fast-03`) |
| HR category, situation | category id/name + the English rendering |
| Opening statement | first turn (Roman Hinglish, English or Devanagari; each category also has two Hindi examples) |
| Expected AI response / follow-up question | `next=<question>` (e.g. `next=ask_eta`) or the outcome below; quality checks on every reply |
| Expected intent | `s=<employeeResponse>` (coming, absent, wfh, at_office, callback, stopped, escalated, …) |
| Required HRMS data | the call reason (late / absent / missing check-out / overtime / manual) and the employee's own shift; `kb=any` = answered from approved knowledge with its source, or routed to HR |
| Action allowed? | `leave=1` = a leave **draft for HR approval**; nothing else is ever executed by the assistant |
| Human escalation | `esc=1` / `esc=urgent` (and checked in reverse: no escalation where none is expected) |
| Expected language | `language_match` check: the reply follows the employee's language |
| Expected outcome | slots `eta=`, `left=`, `why=`, `cb=`, `stop=1`, and the validated structured output |

Checks run on **every** scenario: structured output validates; one question at a time; no robotic phrases; no
repeated question; AI disclosure in the opening; **no number in a reply that the employee or the HRMS didn't supply**
(no invented times, balances or amounts); no false stop.

## Coverage against the brief's 45 categories

| Brief category | Library categories |
|---|---|
| 1 Attendance issues · 3 Missing check-in · 4 Missing check-out | incorrect_attendance, attendance_correction, attendance_sync, missing_checkin, missing_checkout, forgotten_attendance, biometric_failure, gps_permission, remote_attendance, already_checked_in |
| 2 Late arrival | late_arrival, traffic, public_transport, vehicle_breakdown, weather, medical_appointment |
| 5 Leave requests · 6 Leave balance · 7 Emergency leave · 8 Sick leave | leave_already_applied, leave_pending, leave_rejected, leave_balance, leave_cancellation, emergency_leave, sudden_illness, medical_emergency, employee_absence, unplanned_absence, half_day, attendance_leave_conflict |
| 9 Payroll · 10 Salary discrepancies · 11 Payslips · 12 Incentives | payroll_enquiry, salary_discrepancy, payslip, incentive, reimbursement, final_settlement |
| 13 Overtime | overtime_requests, overtime_rejection, overtime_availability, overtime_timing |
| 14 Shift changes · 15 Weekly offs · 16 Holidays | shift_changes, shift_swaps, night_shifts, rotational_shifts, overlapping_shifts, weekly_off, holiday_enquiry, approved_holiday |
| 17 Onboarding · 18 Offer letters · 19 Documents · 20 Profile updates | onboarding, offer_letter, joining_date, document_submission, profile_update, bank_details, emergency_contact, id_card |
| 21 Manager communication · 22 Performance feedback | manager_approval_delay, manager_escalation, performance, **performance_plans** (new: goals, PIP, feedback) |
| 23 Work complaints · 24 Conflicts · 25 Harassment/misconduct | grievance, workload, workplace_conflict, harassment_report (urgent), accident_report, workplace_emergency |
| 26 Resignation · 27 Notice period · 28 Exit | resignation, notice_period, exit_formalities |
| 29 Training · 30 HRMS support | training, hrms_login, hrms_access, notification_explanation |
| 31 Privacy concerns | privacy_concerns, recording_questions, ai_identity, **other_employee_privacy** (new: another person's salary/contact/leave/complaint, tokens, passwords, prompts → refused by rule) |
| 32 Repeated questions · 34 Confused · 43 Incomplete info | confused, incomplete_answers, multiple_pending, complex_multi |
| 33 Angry employees | angry |
| 35 Hindi only · 36 Hinglish · 37 English | hindi_only, hinglish, english_only, language_switching |
| 38 Background noise | poor_network, **background_noise** (new: recogniser tags like `[music]`, fragments, noisy places) |
| 39 Interruptions | **interruptions** (new: "ruko ruko", "ek minute", talking over Naina) |
| 40 Refuse to answer | refusal, busy, callback, stop_calling |
| 41 Unrelated questions | unrelated_questions, general_hr, recognition |
| 42 Asks for a human | human_hr, hr_escalation, hr_followup |
| 44 Change their answers | contradictory_answers |
| 45 Fast / informal speech | **informal_fast** (new: "aa ra hu 11 tk", "omw 15 mins", "nai aa paunga") |
| Recruitment (§7) | **recruitment** (new: openings, referrals, interview schedule, candidate status; decisions go to HR) |
| Emergencies, accessibility | personal_emergency, family_emergency, accessibility |

## What the new categories found (and fixed)

Writing the first 50 new scenarios (five categories) and running them gave **1,040 / 1,050** before any engine change, which exposed real gaps:

| Found | Fix (engine / NLU) |
|---|---|
| "Ek minute, ek minute" was taken as *arriving in one minute* and Naina switched to English | new `hold` intent: she waits ("Ji, zaroor. Main yahin hoon…"), the question stays open, the language doesn't change, "ek minute" is never an ETA |
| `[music]`, `[inaudible]` were treated as words | `stripNoise()`: recogniser tags are silence (silence is never consent) |
| "aage se mujhe **ye calls** mat karna" wasn't a stop request | stop phrases extended |
| "construction ka kaam chal raha hai bagal mein" was read as *still working* and ended the call | work going on nearby no longer counts |
| "office hi **hu**", "nai aa paunga", "krte h" not understood | informal spellings normalised (`hu→hoon`, `h→hai`, `ni/nai→nahi`, `kr→kar`, `tk→tak`, `omw→on my way`…) |
| "Rahul ki salary kitni hai?" got a generic payroll answer | `other_person_info` / `secret_request` rules: refused, then back to the question |

Three of the ten first-run failures were mistakes in the scenarios themselves (two callbacks without a time, where
"what time?" is the correct reply; a missed check-out answer filed under a late-arrival call) and were corrected; two
new utterances turned out identical to existing ones once informal spellings were normalised and were replaced. No
check was weakened. The tenth category (`other_employee_privacy`) then caught that the first version of the privacy
rule was too broad ("pichhle mahine ki salary" is the employee's own): 11 existing scenarios regressed until it was
narrowed. All 1,000 earlier scenarios pass.

## Honest limits

* Scenarios are text. Real speech recognition errors (Hinglish accents, noise) are approximated by the noisy and
  informal categories, not measured; that needs recordings from real employees (with consent).
* The held-out split (every fifth scenario) was written by the same author; it is an indication, not an independent
  benchmark.
* All-lowercase names ("rahul ki salary") aren't recognised as another person; no data is exposed (there is no code
  path to other employees' records), but the reply is a generic one instead of an explicit refusal.
