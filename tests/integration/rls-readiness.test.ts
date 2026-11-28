import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { db } from "@/server/db";
import { policySql, readCatalog, rollbackSql, roleSql } from "@/server/rls";
import { withTenant } from "@/server/tenant-context";
import { resetDb } from "./helpers";

/**
 * Proves the row-level-security machinery (not enabled in production): a NON-owner role is confined to one tenant per transaction,
 * and the generated SQL is valid for every real table. See docs/MEDORO_2.md section 5 for the staged rollout.
 */
const A = "11111111-1111-4111-8111-111111111111", B = "22222222-2222-4222-8222-222222222222";
const ROLE = "rls_probe_user", PW = "probe-pw-" + Math.random().toString(36).slice(2, 10);
const PARENT = "zz_probe_parent", CHILD = "zz_probe_child";
const q = (s: string) => `"${s}"`;

/** Platform data deliberately NOT covered by tenant policies. A new table landing here must be decided on: tenant-owned data gets a tenantId column or a foreign key to a tenant table; platform data is added to this list on purpose. */
const PLATFORM = "AiAsk,BackgroundJob,CallSession,CampaignRecipient,CatalogueBarcode,CatalogueChange,CatalogueMedicine,ContactConsent,ConversionRecord,Coupon,CpBillingEvent,CpCustomer,CpNote,CpOnlinePayment,CpSale,CpSetting,DemoBooking,EmployeeCallingTarget,EmployeeDailyPerformance,EmployeeTerritory,EventOutbox,FollowUpTask,GrowthAuditLog,GrowthMember,GrowthSetting,GrowthTeam,HrAllyUsage,HrAnnouncement,HrAsset,HrAttendance,HrBreak,HrCandidate,HrChat,HrChatBackup,HrChatMember,HrChatMessage,HrChatReaction,HrChatVote,HrClaim,HrCorrection,HrDepartment,HrDocument,HrGoogle,HrHoliday,HrIdle,HrJob,HrLeave,HrLetter,HrMeeting,HrNotification,HrPayslip,HrProfile,HrProject,HrAccessGrant,HrActivityDispute,HrAppCategory,HrApproval,HrApprovalStep,HrCourse,HrCourseAttempt,HrCourseEnrolment,HrSurvey,HrSurveyResponse,HrDelegation,HrDevice,HrDeviceCode,HrInsight,HrKpi,HrKpiResult,HrMonitorAck,HrShift,HrShiftAssignment,HrWorkEvent,HrEmploymentEvent,HrPromotion,HrWaMessage,HrOfferSign,HrLetterSign,HrPolicy,HrPolicyAck,HrExit,HrReviewCycle,HrReview,HrRecognition,HrRecord,HrRisk,HrSalaryRevision,HrSelfie,HrSetting,HrSprint,HrTask,HrTicket,IntegrationConnection,Lead,LeadActivity,LeadAssignment,LeadAssignmentHistory,LeadDuplicateCandidate,LeadEvidence,LeadImportJob,LeadLog,LeadNote,LeadScore,LeadSource,LoginAttempt,MessageConversation,MessageEvent,MessageTemplate,OtpCode,PharmacyContact,PharmacyLead,RateLimit,RemoteAccessRequest,SalesCampaign,SalesDeal,StaffAudit,StaffBank,StaffPayout,StaffSession,StaffUser,SuppressionRecord,SystemHeartbeat,Tenant,Ticket,TicketMessage,DistChemistAccount,DistPortalSession,TrProgramme,TrSession,TrModule,TrLesson,TrLessonVersion,TrQuestion,TrScenario,TrBatch,TrAssignment,TrProgress,TrAttempt,TrPractical,TrCertificate".split(",");

function asRole(): PrismaClient {
  const u = new URL(process.env.DATABASE_URL!);
  u.username = ROLE; u.password = PW;
  u.searchParams.set("connection_limit", "1");          // one connection, so a leaked setting WOULD show up on the next query
  return new PrismaClient({ datasources: { db: { url: u.toString() } } });
}

describe("row-level security readiness", () => {
  describe("catalogue and generated SQL", () => {
    it("classifies every table: tenant-owned directly, tenant-owned through a parent, or platform data", async () => {
      const cat = await readCatalog(db);
      expect(cat.tenantTables).toEqual(expect.arrayContaining(["Sale", "Customer", "StockMovement", "Voucher", "Grn", "Batch", "Medicine", "ComplianceItem", "ForecastSnapshot", "IntegrationHealth", "RecallDisposal"]));
      expect(cat.children.map((c) => c.child)).toEqual(expect.arrayContaining(["SaleItem", "Payment", "LedgerLine", "GrnItem", "PurchaseOrderItem", "Session", "RecoveryCode", "AuthCode", "DeliveryOrderItem"]));
      expect(cat.children.find((c) => c.child === "SaleItem")).toMatchObject({ fkCol: "saleId", parent: "Sale" });
      const all = [...cat.tenantTables, ...cat.children.map((c) => c.child), ...cat.uncovered];
      expect(new Set(all).size).toBe(all.length);                                    // no table in two groups
      expect(cat.uncovered).toEqual(expect.arrayContaining(["Tenant", "StaffUser", "CatalogueMedicine"]));
      expect(cat.uncovered.filter((t) => !PLATFORM.includes(t))).toEqual([]);       // a NEW uncovered table must be classified on purpose
    });

    it("the generated policies apply cleanly to every real table (rolled back: nothing is left behind)", async () => {
      const cat = await readCatalog(db);
      const stmts = [`CREATE ROLE ${q("rls_dryrun")} NOLOGIN`, ...policySql(cat, { role: "rls_dryrun" })];
      class Rollback extends Error {}
      await db.$transaction(async (tx) => {
        for (const s of stmts) await tx.$executeRawUnsafe(s);
        const n = await tx.$queryRaw<{ n: bigint }[]>`SELECT count(*)::bigint n FROM pg_policies WHERE policyname = 'medoro_tenant_isolation'`;
        expect(Number(n[0].n)).toBe(cat.tenantTables.length + cat.children.length);
        throw new Rollback();
      }).catch((e) => { if (!(e instanceof Rollback)) throw e; });
      const left = await db.$queryRaw<{ n: bigint }[]>`SELECT count(*)::bigint n FROM pg_policies WHERE policyname = 'medoro_tenant_isolation'`;
      const force = await db.$queryRaw<{ n: bigint }[]>`SELECT count(*)::bigint n FROM pg_class WHERE relforcerowsecurity`;
      const role = await db.$queryRaw<{ n: bigint }[]>`SELECT count(*)::bigint n FROM pg_roles WHERE rolname = 'rls_dryrun'`;
      expect([Number(left[0].n), Number(force[0].n), Number(role[0].n)]).toEqual([0, 0, 0]);
    });

    it("emits a role template that grants data access only", () => {
      const lines = roleSql("medoro_app");
      expect(lines.join("\n")).toMatch(/NOSUPERUSER NOBYPASSRLS/);
      const live = lines.filter((l) => !l.startsWith("--"));                      // statements, not the commented example
      expect(live.length).toBeGreaterThan(0);
      for (const l of live) expect(l).toMatch(/^(GRANT (USAGE|SELECT)|ALTER DEFAULT PRIVILEGES)/);
      expect(live.join("\n")).not.toMatch(/GRANT ALL|TRUNCATE|DROP|CREATE|REFERENCES|TRIGGER|BYPASSRLS/);
    });
  });

  describe("a non-owner role is confined to one tenant", () => {
    let probe: PrismaClient;
    beforeAll(async () => {
      await resetDb();
      await db.$executeRawUnsafe(`DROP TABLE IF EXISTS ${q(CHILD)}, ${q(PARENT)}`);
      await db.$executeRawUnsafe(`DROP ROLE IF EXISTS ${q(ROLE)}`);
      await db.$executeRawUnsafe(`CREATE TABLE ${q(PARENT)} (id text PRIMARY KEY, ${q("tenantId")} text NOT NULL, name text NOT NULL)`);
      await db.$executeRawUnsafe(`CREATE TABLE ${q(CHILD)} (id text PRIMARY KEY, ${q("parentId")} text NOT NULL REFERENCES ${q(PARENT)}(id), qty int NOT NULL)`);
      await db.$executeRawUnsafe(`CREATE ROLE ${q(ROLE)} LOGIN PASSWORD '${PW}' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE`);
      await db.$executeRawUnsafe(`GRANT SELECT, INSERT, UPDATE, DELETE ON ${q(PARENT)}, ${q(CHILD)} TO ${q(ROLE)}`);
      await db.$executeRawUnsafe(`INSERT INTO ${q(PARENT)} VALUES ('pa1', '${A}', 'A one'), ('pa2', '${A}', 'A two'), ('pb1', '${B}', 'B one')`);
      await db.$executeRawUnsafe(`INSERT INTO ${q(CHILD)} VALUES ('ca1', 'pa1', 5), ('cb1', 'pb1', 9)`);
      // the SAME generator the real tables use, applied to the probe tables
      for (const s of policySql({ tenantTables: [PARENT], children: [{ child: CHILD, fkCol: "parentId", parent: PARENT, parentCol: "id" }] }, { role: ROLE })) await db.$executeRawUnsafe(s);
      probe = asRole();
    });
    afterAll(async () => {
      await probe?.$disconnect();
      for (const s of rollbackSql({ tenantTables: [PARENT], children: [{ child: CHILD, fkCol: "parentId", parent: PARENT, parentCol: "id" }] }, { role: ROLE })) await db.$executeRawUnsafe(s).catch(() => undefined);
      await db.$executeRawUnsafe(`DROP TABLE IF EXISTS ${q(CHILD)}, ${q(PARENT)}`);
      await db.$executeRawUnsafe(`DROP ROLE IF EXISTS ${q(ROLE)}`);
    });

    const names = (c: { $queryRawUnsafe: PrismaClient["$queryRawUnsafe"] }, t = PARENT) => c.$queryRawUnsafe<{ id: string }[]>(`SELECT id FROM ${q(t)} ORDER BY id`).then((r) => r.map((x) => x.id));

    it("the probe role really is not privileged", async () => {
      const [r] = await probe.$queryRawUnsafe<{ s: boolean; b: boolean }[]>(`SELECT rolsuper s, rolbypassrls b FROM pg_roles WHERE rolname = current_user`);
      expect(r).toEqual({ s: false, b: false });
      expect(await names(db)).toEqual(["pa1", "pa2", "pb1"]);                       // the owner/superuser sees everything: the control
    });

    it("with no tenant set it sees nothing, in the parent and the child table", async () => {
      expect(await names(probe)).toEqual([]);
      expect(await names(probe, CHILD)).toEqual([]);
    });

    it("with a tenant set it sees only that tenant's rows, children included", async () => {
      expect(await withTenant(probe, A, (tx) => names(tx))).toEqual(["pa1", "pa2"]);
      expect(await withTenant(probe, A, (tx) => names(tx, CHILD))).toEqual(["ca1"]);
      expect(await withTenant(probe, B, (tx) => names(tx))).toEqual(["pb1"]);
      expect(await withTenant(probe, B, (tx) => names(tx, CHILD))).toEqual(["cb1"]);
    });

    it("the tenant setting dies with the transaction: the next query on the same connection sees nothing", async () => {
      await withTenant(probe, A, (tx) => names(tx));
      expect(await names(probe)).toEqual([]);                                       // connection_limit=1: it IS the same connection
      const [s] = await probe.$queryRawUnsafe<{ v: string | null }[]>(`SELECT NULLIF(current_setting('app.tenant_id', true), '') v`);
      expect(s.v).toBeNull();
    });

    it("cannot write another tenant's data, nor move its own rows to another tenant", async () => {
      await expect(withTenant(probe, A, (tx) => tx.$executeRawUnsafe(`INSERT INTO ${q(PARENT)} VALUES ('px', '${B}', 'planted')`))).rejects.toThrow(/row-level security/i);
      await expect(withTenant(probe, A, (tx) => tx.$executeRawUnsafe(`UPDATE ${q(PARENT)} SET ${q("tenantId")} = '${B}' WHERE id = 'pa1'`))).rejects.toThrow(/row-level security/i);
      await expect(withTenant(probe, A, (tx) => tx.$executeRawUnsafe(`INSERT INTO ${q(CHILD)} VALUES ('cx', 'pb1', 1)`))).rejects.toThrow(/row-level security/i);   // a child under another tenant's parent
      expect(await withTenant(probe, A, (tx) => tx.$executeRawUnsafe(`UPDATE ${q(PARENT)} SET name = 'hacked' WHERE id = 'pb1'`))).toBe(0);   // invisible rows can't be touched
      expect(await withTenant(probe, A, (tx) => tx.$executeRawUnsafe(`DELETE FROM ${q(PARENT)} WHERE id = 'pb1'`))).toBe(0);
      expect(await names(db)).toEqual(["pa1", "pa2", "pb1"]);
      expect((await db.$queryRawUnsafe<{ name: string }[]>(`SELECT name FROM ${q(PARENT)} WHERE id = 'pb1'`))[0].name).toBe("B one");
    });

    it("can write its own tenant's data", async () => {
      await withTenant(probe, A, (tx) => tx.$executeRawUnsafe(`INSERT INTO ${q(PARENT)} VALUES ('pa3', '${A}', 'A three')`));
      await withTenant(probe, A, (tx) => tx.$executeRawUnsafe(`INSERT INTO ${q(CHILD)} VALUES ('ca3', 'pa3', 2)`));
      expect(await withTenant(probe, A, (tx) => names(tx))).toEqual(["pa1", "pa2", "pa3"]);
      expect(await withTenant(probe, B, (tx) => names(tx))).toEqual(["pb1"]);
    });

    it("refuses a malformed tenant id instead of passing it to the database", async () => {
      await expect(withTenant(probe, "x'; DROP TABLE y; --", async () => 1)).rejects.toThrow(/valid tenant id/);
      await expect(withTenant(probe, "", async () => 1)).rejects.toThrow(/valid tenant id/);
    });
  });
});
