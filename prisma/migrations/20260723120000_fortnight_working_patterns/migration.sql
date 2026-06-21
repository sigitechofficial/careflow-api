-- Fortnight working patterns: weekInCycle on pattern rows, cycle config on employment.

ALTER TABLE "employees"."EmployeeEmployment"
  ADD COLUMN "workingPatternCycleWeeks" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "workingPatternCycleAnchorDate" TIMESTAMP(3);

ALTER TABLE "employees"."EmployeeWorkingPattern"
  ADD COLUMN "weekInCycle" INTEGER NOT NULL DEFAULT 1;

UPDATE "employees"."EmployeeWorkingPattern"
SET "weekInCycle" = 1
WHERE "weekInCycle" IS NULL;

CREATE INDEX "EmployeeWorkingPattern_employeeId_weekInCycle_dayOfWeek_idx"
  ON "employees"."EmployeeWorkingPattern"("employeeId", "weekInCycle", "dayOfWeek");

CREATE UNIQUE INDEX "EmployeeWorkingPattern_employee_week_day_active_key"
  ON "employees"."EmployeeWorkingPattern"("employeeId", "weekInCycle", "dayOfWeek")
  WHERE "deletedAt" IS NULL;
