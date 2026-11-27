# Enterprise HRMS 2.0 — Phase 7: learning, engagement and the AI HR assistant

## Learning (screen *Learning*, everyone; HR builds with the Employees module)
Courses for everyone or a department and/or designation (the Sales Academy remains the sales programme): lessons
(text, optional https link), an optional quiz, pass mark, required or optional, days to finish. Publishing enrols the
audience; people who later fall into it are enrolled when they open Learning; HR can also assign anyone. Every lesson
must be read before the quiz; quizzes are **marked on the server** and the correct answers are never sent to the
browser; 3 attempts (HR can reset); every attempt is kept with the course version (append-only). Editing a published
course bumps its version. Daily reminders for required courses: once when due within 3 days, once when overdue.

## Engagement (screen *Engagement*)
Pulse surveys (1–5 agreement, 0–10 eNPS, text) for everyone or a department, anonymous by default. Anonymous answers
store **no staff id**: an HMAC of survey + person (keyed with `SESSION_SECRET`) only prevents answering twice, plus the
department for breakdowns. Results, department breakdowns and free text are shown only for groups of **5 or more**.
Named surveys show who answered. Opening results is audited. Limit: someone holding both the database and the server
secret could recompute the hash; stated on the screen and here.

## Ally, the HR assistant
Still answers only from the person's own records and company data, never remote AI for HR data. New: **answers from the
company's published policies**, quoting the passage and naming the policy (keyword retrieval in
`ally-knowledge.ts`; below the match threshold it says it doesn't know instead of guessing), the person's **KPIs**,
**courses** due and today's **shift**. A clear policy match answers first unless the question is about the person's own
records. With a local model configured, the relevant passages are handed to it with an instruction to name the policy
and never invent one.

## Files
New: `learning.ts`, `surveys.ts`, `ally-knowledge.ts` (+ unit test), `_ui/screens-learning.tsx`, migration
`20261215000000_hrms_learning_engagement`, `tests/integration/hrms-learning.test.ts`. Changed: `ally.ts`, `constants.ts`,
`screens.ts`, `actions.ts`, `_ui/screens.tsx`, `cron.ts` (`learningTick`), `restore.ts`, `rls-readiness.test.ts`.

## Tests (actual)
Unit (3): term normalisation, passage retrieval with citation, no answer when policies don't cover it.
Integration (6): HR-only authoring and validation; publish enrols the audience only, assignment outside it; answers
never sent; lessons before quiz; server marking 0/50/100; completion locks; attempt history append-only; attempt limit;
reminders once per stage; anonymous survey stores no staff id, one answer each, invalid value refused, hidden below 5,
eNPS 17 and average 3.8 from six answers, text answers, department breakdown hidden for a group of 1; department
survey refused to others, named survey lists respondents; Ally quotes the work-from-home policy with its title, lists
the required course, says no KPIs apply. Full suite: 230 files / 1,403 tests pass (existing Ally tests unchanged);
lint and typecheck pass.
