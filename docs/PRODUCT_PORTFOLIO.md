# Sumit Kumar Suman — Product Portfolio

This portfolio index brings together the four SaaS products and their source repositories. It is a project overview, not a substitute for each repository's detailed technical documentation.

## 1. GoXL Ally — AI Founder-Advisory SaaS
**Website:** https://goxlally.ai  
**Positioning:** AI for Founder Clarity.

A founder-advisory platform designed to help founders assess business health, identify priority problems and turn decisions into actionable plans. Product scope includes founder and business onboarding, AI diagnosis, clarity reports, prioritised recommendations, contextual AI chat, goals, daily planning and vision-board workflows. Subscription and payment workflows are part of the product plan.

**Delivery scope:** Product discovery, requirements and PRDs, user journeys, architecture planning, AI/RAG and agent workflows, UI/UX coordination, integrations, testing and deployment planning.

## 2. Medoro — Pharmacy & Healthcare Management SaaS
**Website:** https://medoro.in  
**Repository:** https://github.com/sumitgoxlofficial-jpg/Medoro

Medoro is a pharmacy operations platform for independent medical stores and multi-branch pharmacy businesses, with a related wholesale distribution ERP.

**Core documented capabilities**
- Pharmacy setup, branches, counters, employee roles and secure sign-in with multi-factor authentication.
- Point-of-sale billing, GST invoices, split payments, customer credit, returns and loyalty.
- Batch-wise inventory, expiry controls, stock transfers, purchase orders, goods receipt, supplier claims and reorder intelligence.
- Customer orders and home delivery workflows, including order status and delivery handover.
- Accounting, ledgers, P&L, GST summaries/returns, bank reconciliation, UPI statement matching and Tally exports.
- WhatsApp invoice and payment/refill reminders, SMS fallback and consent controls, subject to provider credentials.
- Offline counter billing with later reconciliation, desktop app shell, encrypted backup and restore, and multi-device synchronisation.
- Pharmacy AI assistant with permission-aware tools; local or remote model modes are configuration-dependent.
- MEDORO Distribution modules for stockists/distributors and a chemist ordering portal.
- Separate internal HRMS and staff/growth consoles.

**Documented technology:** Next.js 16, React 19, TypeScript, Tailwind CSS 4, Prisma 6, PostgreSQL 16, Zod and Vitest.

## 3. LegalStaff — Legal Practice Management SaaS
**Website:** https://legalstaff.in  
**Repository:** https://github.com/sumitgoxlofficial-jpg/Legal-Staff

LegalStaff is a digital workspace for advocates, chambers, law firms and corporate legal teams. It combines a legal-practice management app with a public advocate directory and a standalone signing experience.

**Documented product areas**
- Practice onboarding by user type and area of law, with practice-specific dashboard figures, quick actions, case stages, limitation presets and navigation.
- Matter and case administration, client records, hearings, court orders, invoices and related practice workflows.
- Legal limitation calculator and order/document reading features.
- Advocate directory for professional discovery.
- Drafting Studio electronic-signing workflow, including a signer page that does not require the signer to create an account.
- Data export and backup/restore tools; firm data uses Supabase when configured and browser storage otherwise.
- AI support using Groq, morning briefings and team invitations as documented in the repository.
- UPI payment reconciliation from bank alert emails and trial/plan-ending reminders.
- WhatsApp reminders and live court-status lookup require separately configured external provider credentials.

**Documented implementation:** Static HTML/CSS/JavaScript application with React 18 bundled in the vendor directory, application data and view modules, Supabase integration, and serverless functions for configured integrations.

## 4. FITRON — Gym Management, Accounting & AI Fitness SaaS
**Website:** https://fitron.in  
**Repository:** https://github.com/sumitgoxlofficial-jpg/fitron

FITRON serves India's fitness market through connected products:
- **FITRON Gym Accounting:** Gym members, membership plans and renewals, billing, GST invoices, payments, expenses, profit and loss, staff, attendance, classes, leads, POS, WhatsApp reminders, UPI Autopay, door-device integrations and multi-branch operations.
- **FITRON AI Trainer:** Personalised workout plans, Indian meal plans based on city/diet/budget, an AI coach, habits, progress tracking and weekly reviews.
- **Gym Partnership:** Partner gyms can refer members to the AI Trainer and receive the documented revenue share on referred member subscriptions.
- **FITRON Windows:** Optional desktop experience designed for offline gym operations with cloud sync when connectivity returns.

**Documented technology:** Next.js App Router, TypeScript, Tailwind CSS, PostgreSQL and Prisma. The repository also documents a production WhatsApp connector using Node.js/TypeScript, PostgreSQL, Redis and Docker, plus Razorpay subscription/payment workflows.

## Product & Project Management Responsibilities
Across these initiatives, the work includes product strategy and roadmap planning, requirements gathering, PRD/SRS and acceptance criteria, architecture and technology planning, UI/UX and user-journey coordination, sprint planning, cross-functional delivery, API/payment/messaging integration coordination, QA and release readiness, deployment planning, operational workflows and stakeholder communication.

## Source repositories
- [Medoro](https://github.com/sumitgoxlofficial-jpg/Medoro)
- [LegalStaff](https://github.com/sumitgoxlofficial-jpg/Legal-Staff)
- [FITRON](https://github.com/sumitgoxlofficial-jpg/fitron)

## Accuracy note
Feature availability may depend on deployment configuration, credentials, subscriptions or third-party providers. Refer to each repository's README and deployment documentation for the current implementation status. GoXL Ally's summary above is based on the supplied CV and previously supplied product scope; no GoXL Ally repository was supplied in this portfolio update.