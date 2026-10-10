-- Default nearest-visit grace for the Tasks Planner: 60 minutes (null still means no limit).
ALTER TABLE "service_users"."ServiceUser"
  ALTER COLUMN "taskNearestVisitGraceMinutes" SET DEFAULT 60;

-- The setting is new; give every existing client the default.
UPDATE "service_users"."ServiceUser"
SET "taskNearestVisitGraceMinutes" = 60
WHERE "taskNearestVisitGraceMinutes" IS NULL;
