# Sales Training Academy (HRMS)

A one-day programme that prepares a new Medoro Sales Executive, inside the HRMS (`/staff/hrms`). Same sign-in, same
employee records, same audit log. Code: `src/staff/hrms/training/`, screens `src/app/staff/hrms/_ui/screens-training.tsx`
and `screens-academy.tsx`, tests `tests/integration/hrms-training.test.ts`, `src/staff/hrms/training/*.test.ts` and the end-to-end
walkthrough `e2e/34-sales-academy.spec.ts` (every HR, trainer and learner action through the real UI on a production build:
real video and slide evidence, quizzes, practicals, approvals, certificate PDF and verification, revocation, access rules,
a broken video, a blocked video host, a fake PDF and phone width; about 5 minutes).

## Who sees what

| Who | Screen | What they can do |
|---|---|---|
| Employee with an assignment | **My Sales Training** (WORK) | Schedule, lessons, official product tour, lesson checks, product quiz, final exam, practical submissions, results, certificate PDF |
| A batch's trainer (any team member HR picks) | **Trainer Desk** (TEAM) | Their batches only: attendance, score practicals against the rubric, recommend or send back, feedback |
| HR (the new **Sales Academy** module in Roles & Permissions; on by default for HR) | **Sales Academy** (PEOPLE) | Install the course, batches and assignments, course builder, video & PPT library, quizzes, scenarios, scoring, HR approval, certificates, reports, pricing note |
| Super admin | Sales Academy + Settings | Everything above, plus the assessment rules (pass marks, attempts, HR approval, attendance) |

The menu items only appear for the people they concern. Nobody can assess, approve or certify their own training; an
employee can only ever load their own assignment, and answer keys never reach the browser before grading.

## First batch: exact steps for HR

1. **Sales Academy → Install the standard course** (once). It loads the timetable, 13 modules / 38 lessons (26 official
   tour chapters + 12 lectures), 26 product-quiz questions, the final exam, lesson checks and 7 role-play scenarios. Nobody is assigned.
2. **Settings** tab: write the *approved pricing and offers* sales staff may quote and the certificate signatory. (The super
   admin sets pass marks and attempts; defaults: 80/100 overall, 80% product quiz, 70% lesson checks and practicals, 3 attempts.)
3. **Training Batches**: name, training date, trainer, tick the employees → **Create batch & assign**. Only active people
   with the Sales role or in the Sales department can be assigned, once each; the trainer and employees get a notification.
4. On the day the employee works through **My Sales Training**. The trainer marks attendance and scores the mock call and
   demo on the **Trainer Desk**, then presses **Recommend for certificate** (possible only when every requirement is met).
5. HR sees the person under **Training Overview → Waiting for HR approval** → **Approve & issue**. The certificate is
   generated at that moment, appears in the employee's My Certificates, and can be downloaded as a PDF.
6. **Training Reports → Download employee-wise report (CSV)** at any time.

## Design

The screens use the HRMS look (teal, gold accents) with graphics drawn in SVG (`_ui/training-art.tsx`): a journey map of
the five steps to the certificate, a score gauge with the pass mark, per-area mark bars, a live timeline of the day, lecture
covers, animated slide transitions (← → keys work), a celebration when a lesson or quiz is passed, a certificate preview,
and an HR pipeline chart. Motion lives in `globals.css` (`tr-*`) inside `.hr-app`, so it stops for anyone whose device asks
for reduced motion; nothing depends on animation to be readable.

## Rules the server enforces

* **Progress is evidence, not page views.** The browser sends a heartbeat every 10 s; the server credits only the time
  that really passed (at most 30 s per beat), only while the video plays in a visible tab, and only for video actually
  played through at up to 2× speed (5-second segments; seeking ahead marks nothing). A video lesson needs 90% (editable per
  lesson) watched; a slide lesson needs a minimum time on every slide (longer narration needs longer). A lesson then also
  needs its check passed. The video resumes from where it was left.
* **Quizzes** are graded on the server; every question must be answered; results show wrong answers with explanations.
  The product quiz opens after the tour, the final exam after every mandatory lesson. Attempts are limited (HR can grant one
  more per person); every attempt is kept.
* **Marks (100):** Product knowledge 20 (product quiz), Sales communication 15 and CRM 5 (final exam questions by area),
  Cold calling 20, Objection handling 10, Professionalism 10 (mock-call rubric), Product demonstration 20 (demo rubric).
  Practicals are scored only by the batch trainer or HR; no AI scoring.
* **Certificate** only when: attendance present (if required), the whole tour and every mandatory lesson complete, product
  quiz passed, final exam taken, both practicals passed, score ≥ pass mark, trainer approval, and HR approval (if required).
  Checked again on the server at issue time; one certificate per assignment (`MS-STA-YYYY-NNNN`). A revoked certificate stays
  on record and shows as revoked at `/certificate/verify/<code>` (the QR code on the PDF).
* **Content** lives in the database. Each lesson edit keeps the previous version (restore from the editor). Lesson videos
  can be an official tour part, an MP4/WebM on this site or the configured video host, or YouTube; other hosts are refused
  because the security policy would block them. Attachments: PDF or .pptx (checked by content), served only to assigned
  learners, trainers and HR. Every lesson also downloads as a slides-and-notes PDF.
* Important actions (installs, edits, assignments, scores, decisions, certificates, report downloads) go to Audit Logs.

## Content and honesty

The 26 chapters follow the official tour (`/videos/complete-product-tour`): the original part MP4s are embedded unchanged,
with timings from `src/data/tour-videos.ts` and the Hinglish subtitles from `MEDORO_PRODUCT_TOUR/26_Scripts_Subtitles`.
Every claim in the lessons was written from that narration and this repository; things the product does not do (a
cash-flow report, automatic GST filing, guaranteed OCR scanning, guaranteed results) are taught as "not available" or
"depends on setup". GST answers always point to the customer's CA; Schedule H/H1 answers keep the pharmacist's legal
responsibility; no clinical advice; prices only from HR's approved note or the live pricing page.

## Limits

* There are no recorded trainer videos for the sales lectures (only the product tour has real video). They are slide
  lectures with full Hinglish narration scripts, read aloud by the browser's speech voice where one is installed ("Play
  narration"). HR can attach a real recording to any lesson in the Course Builder.
* Slides download as PDF; HR uploads .pptx files if PowerPoint originals are wanted (none are generated).
* The mock call is submitted as the employee's written account (plus an optional recording link) and scored by the trainer;
  the role-play itself happens live with the trainer.
* The rubric weighting is fixed in code (`training/shared.ts`); pass marks and attempts are settings.
