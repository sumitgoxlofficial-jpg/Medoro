// Shared by the server and the screens (no server imports). The workforce-monitoring policy every employee reads and
// accepts before their company PC sends anything. Changing what is recorded means a new version: everyone accepts again.
export const MONITOR_POLICY_VERSION = 1;
export const MONITOR_POLICY: { title: string; points: string[] } = {
  title: "Workforce activity on company PCs",
  points: [
    "What is recorded: which program is in front (its process name, for example EXCEL or chrome), and whether you are active, idle (no keyboard or mouse for a few minutes) or have the screen locked. Nothing else.",
    "What is never recorded: keystrokes, passwords, screenshots, screen recordings, window titles, website addresses, documents or files, messages, clipboard, microphone, camera or location.",
    "When: only on a company PC enrolled by HR, only while you are checked in in the HRMS and not on a break, and only after you accept this policy. Personal devices are never enrolled.",
    "You can always see it: the Medoro icon in the Windows tray shows whether anything is being recorded, and My activity shows you everything recorded about you.",
    "It is context, not a score: activity is never used on its own to judge your performance. Your KPIs measure output, quality and outcomes; activity only helps explain them.",
    "You can correct it: if something is wrong (you were in a meeting, a program was misclassified), raise a dispute in My activity. If HR accepts it, those minutes are removed from every total.",
    "Who can see it: you, and HR with the Attendance module. HR opening your detailed activity is written to the audit log. Records are deleted after 90 days.",
  ],
};
export const APP_CATEGORIES = ["work", "neutral", "personal"] as const;
export type AppCategory = (typeof APP_CATEGORIES)[number] | "unknown";
