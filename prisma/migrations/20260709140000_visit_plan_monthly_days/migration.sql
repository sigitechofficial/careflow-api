-- Monthly visit day selection (by date 1-31 or by pattern e.g. First Monday)

CREATE TYPE "service_users"."VisitPlanMonthlyDayMode" AS ENUM ('BY_DATE', 'BY_PATTERN');
CREATE TYPE "service_users"."VisitPlanMonthlyOrdinal" AS ENUM ('FIRST', 'SECOND', 'THIRD', 'FOURTH', 'LAST');

ALTER TABLE "service_users"."VisitPlanSlot"
  ADD COLUMN "monthlyDayMode" "service_users"."VisitPlanMonthlyDayMode" NOT NULL DEFAULT 'BY_DATE',
  ADD COLUMN "monthlyDaysOfMonth" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[],
  ADD COLUMN "monthlyPatternOrdinal" "service_users"."VisitPlanMonthlyOrdinal",
  ADD COLUMN "monthlyPatternWeekday" INTEGER;
