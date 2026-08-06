-- Per-task frequency & schedule rules (aligned with VisitPlanSlot scheduling)

ALTER TABLE "service_users"."ServiceUserVisitTaskAssignment"
  ADD COLUMN IF NOT EXISTS "daysOfWeek" INTEGER[] NOT NULL DEFAULT ARRAY[0, 1, 2, 3, 4, 5, 6]::INTEGER[],
  ADD COLUMN IF NOT EXISTS "scheduleFrequency" "service_users"."VisitPlanScheduleFrequency" NOT NULL DEFAULT 'DAILY',
  ADD COLUMN IF NOT EXISTS "repeatEvery" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS "repeatUnit" "service_users"."VisitPlanRepeatUnit" NOT NULL DEFAULT 'DAYS',
  ADD COLUMN IF NOT EXISTS "timeCritical" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "timeToleranceMinutes" INTEGER NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS "monthlyDayMode" "service_users"."VisitPlanMonthlyDayMode" NOT NULL DEFAULT 'BY_DATE',
  ADD COLUMN IF NOT EXISTS "monthlyDaysOfMonth" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[],
  ADD COLUMN IF NOT EXISTS "monthlyPatternOrdinal" "service_users"."VisitPlanMonthlyOrdinal",
  ADD COLUMN IF NOT EXISTS "monthlyPatternWeekday" INTEGER;

-- Existing rows: keep prior behaviour (due every day in the round)
UPDATE "service_users"."ServiceUserVisitTaskAssignment"
SET
  "daysOfWeek" = ARRAY[0, 1, 2, 3, 4, 5, 6]::INTEGER[],
  "scheduleFrequency" = 'DAILY',
  "repeatEvery" = 1,
  "repeatUnit" = 'DAYS'
WHERE cardinality("daysOfWeek") = 0;
