-- Workforce time policy for HRMS: idle monitor on with a "still working?" prompt after 2 minutes, an 8-hour day from 10:00 AM,
-- and a half-hour lunch from 1:00 PM. This writes the saved Settings row, so it also replaces values someone saved earlier.
-- Only these six keys are set: jsonb `||` keeps every other saved setting (company details, leave policy, weekly offs...).
INSERT INTO "HrSetting" ("key", "value")
VALUES ('settings', '{"idleMonitor": true, "idleMinutes": 2, "workHours": 8, "lunchFrom": "13:00", "lunchTo": "13:30", "lateAfter": "10:00"}'::jsonb)
ON CONFLICT ("key") DO UPDATE SET "value" = "HrSetting"."value" || EXCLUDED."value";
