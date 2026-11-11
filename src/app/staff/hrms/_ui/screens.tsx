"use client";
import type { Data, ScreenId, Shell } from "@/staff/hrms/screens";
import { AssetsScreen, AttendanceScreen, CalendarScreen, HomeScreen, MyProjectsScreen, JobsScreen, LeaveScreen, MyTasksScreen, PayslipsScreen, ProfileScreen, SupportScreen } from "./screens-me";
import { AllyUsageScreen, ApprovalsScreen, AssignTasksScreen, AuditScreen, CredentialsScreen, DashboardScreen, DepartmentsScreen, EmployeesScreen, HrAttendanceScreen, HrLeaveScreen, NewEmployeeScreen, OnboardingScreen, PayrollScreen, PermsScreen, PerfScreen, RecruitScreen, ReportsScreen, SettingsScreen } from "./screens-hr";
import { ProjectsScreen } from "./screens-projects";
import { HrLeads, LeadBoard, MyLeads, SalesHome } from "./screens-sales";
import { FinGst, FinHome, FinReports, RegisterScreen, WorkflowsScreen } from "./screens-fin";

/** Picks the screen for the page. `data` is what that screen's loader returned. */
export function Screen({ screen, data, sh }: { screen: ScreenId; data: unknown; sh: Shell }) {
  const d = data as never;
  switch (screen) {
    case "home": return <HomeScreen d={d as Data<"home">} sh={sh} />;
    case "myprojects": return <MyProjectsScreen d={d as Data<"myprojects">} />;
    case "assets": return <AssetsScreen d={d as Data<"assets">} />;
    case "mytasks": return <MyTasksScreen d={d as Data<"mytasks">} />;
    case "calendar": return <CalendarScreen d={d as Data<"calendar">} sh={sh} />;
    case "attendance": return <AttendanceScreen d={d as Data<"attendance">} sh={sh} />;
    case "leave": return <LeaveScreen d={d as Data<"leave">} />;
    case "payslips": return <PayslipsScreen d={d as Data<"payslips">} />;
    case "jobs": return <JobsScreen d={d as Data<"jobs">} />;
    case "support": return <SupportScreen d={d as Data<"support">} />;
    case "profile": return <ProfileScreen d={d as Data<"profile">} />;
    case "slhome": return <SalesHome d={d as Data<"slhome">} sh={sh} />;
    case "slboard": return <LeadBoard d={d as Data<"slboard">} />;
    case "slleads": return <MyLeads d={d as Data<"slleads">} />;
    case "hrhome": case "sahome": return <DashboardScreen d={d as Data<"hrhome">} sh={sh} />;
    case "perf": return <PerfScreen d={d as Data<"perf">} sh={sh} />;
    case "assigntasks": return <AssignTasksScreen d={d as Data<"assigntasks">} />;
    case "assignprojects": return <ProjectsScreen d={d as Data<"assignprojects">} />;
    case "hrleads": return <HrLeads d={d as Data<"hrleads">} />;
    case "hremployees": return <EmployeesScreen d={d as Data<"hremployees">} />;
    case "hrnewemp": return <NewEmployeeScreen d={d as Data<"hrnewemp">} />;
    case "departments": return <DepartmentsScreen d={d as Data<"departments">} />;
    case "recruit": return <RecruitScreen d={d as Data<"recruit">} />;
    case "hrattendance": return <HrAttendanceScreen d={d as Data<"hrattendance">} />;
    case "hrleave": return <HrLeaveScreen d={d as Data<"hrleave">} sh={sh} />;
    case "credentials": return <CredentialsScreen d={d as Data<"credentials">} />;
    case "onboarding": return <OnboardingScreen d={d as Data<"onboarding">} />;
    case "payroll": return <PayrollScreen d={d as Data<"payroll">} />;
    case "reports": return <ReportsScreen d={d as Data<"reports">} />;
    case "allyusage": return <AllyUsageScreen d={d as Data<"allyusage">} />;
    case "finhome": return <FinHome d={d as Data<"finhome">} />;
    case "fin_reports": return <FinReports d={d as Data<"fin_reports">} />;
    case "fin_gst": return <FinGst d={d as Data<"fin_gst">} />;
    case "fin_contacts": case "fin_salescrm": case "fin_mktgcrm": case "fin_sales": case "fin_purchases": case "fin_accounting": case "fin_products": case "fin_banking":
      return <RegisterScreen key={screen} regs={(d as Data<"fin_sales">).regs} />;
    case "fin_workflows": return <WorkflowsScreen d={d as Data<"fin_workflows">} />;
    case "saapprovals": return <ApprovalsScreen d={d as Data<"saapprovals">} />;
    case "saperms": return <PermsScreen d={d as Data<"saperms">} />;
    case "auditlogs": return <AuditScreen d={d as Data<"auditlogs">} />;
    case "settings": return <SettingsScreen d={d as Data<"settings">} />;
  }
}
