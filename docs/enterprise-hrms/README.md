# Medoro Enterprise HRMS 2.0

Eight phases, each with its own report (features, files, database, API, security, tests with actual results, rollback):

1. [Audit and security hardening](PHASE_1_AUDIT.md)
2. [Employee management and organisation hierarchy](PHASE_2_ORG.md)
3. [Granular access, approvals and workflow automation](PHASE_3_RBAC_APPROVALS.md)
4. [Workforce event engine, devices and the Windows agent](PHASE_4_WORKFORCE.md) · [agent/README.md](../../agent/README.md)
5. [Output, KPIs and advisory insights](PHASE_5_KPIS.md)
6. [Attendance, shifts, payroll and workforce operations](PHASE_6_SHIFTS_PAYROLL_OPS.md)
7. [Learning, engagement and the AI HR assistant](PHASE_7_LEARNING_ENGAGEMENT_ALLY.md)
8. [Management dashboards, testing, optimisation and deployment](PHASE_8_MANAGEMENT_TESTING_DEPLOYMENT.md) · [DEPLOYMENT.md](DEPLOYMENT.md)

Decisions taken where the owner hadn't answered (all reversible): the HRMS stays single-organisation; two-step sign-in
for privileged roles, salary-change approval and workforce tracking are Settings switches, **off by default**; new tables
have foreign keys, older HR tables wait for the production integrity report.
