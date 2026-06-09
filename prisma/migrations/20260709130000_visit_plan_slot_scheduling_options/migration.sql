-- Visit plan slot scheduling + additional details (CareBean parity)

CREATE TYPE "service_users"."VisitPlanScheduleFrequency" AS ENUM ('DAILY', 'WEEKLY', 'MONTHLY');
CREATE TYPE "service_users"."VisitPlanRepeatUnit" AS ENUM ('DAYS', 'WEEKS', 'MONTHS');

ALTER TABLE "service_users"."VisitPlanSlot"
  ADD COLUMN "scheduleFrequency" "service_users"."VisitPlanScheduleFrequency" NOT NULL DEFAULT 'DAILY',
  ADD COLUMN "repeatEvery" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "repeatUnit" "service_users"."VisitPlanRepeatUnit" NOT NULL DEFAULT 'DAYS',
  ADD COLUMN "timeCritical" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "timeToleranceMinutes" INTEGER NOT NULL DEFAULT 30,
  ADD COLUMN "durationMinutes" INTEGER,
  ADD COLUMN "notesRequired" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "photoAllowed" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "shareOutcomeWithFamily" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "analysisArea" TEXT;
