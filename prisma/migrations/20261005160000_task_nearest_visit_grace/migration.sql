-- Tasks Planner: max minutes between a task's due time and the nearest visit when no visit
-- covers the task. Null = no limit (task always moves to the nearest visit of the day).
ALTER TABLE "service_users"."ServiceUser"
  ADD COLUMN IF NOT EXISTS "taskNearestVisitGraceMinutes" INTEGER;
