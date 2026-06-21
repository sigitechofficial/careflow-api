-- Scheduled package end + retrospective audit fields on status events; absence retrospective reason

ALTER TYPE "service_users"."VisitPlanStatusEventType" ADD VALUE IF NOT EXISTS 'SCHEDULED_END';

ALTER TABLE "service_users"."VisitPlanStatusEvent"
  ADD COLUMN IF NOT EXISTS "effectiveFrom" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "effectiveTo" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "retrospectiveReason" TEXT NOT NULL DEFAULT '';

ALTER TABLE "service_users"."ServiceUserAbsence"
  ADD COLUMN IF NOT EXISTS "retrospectiveReason" TEXT NOT NULL DEFAULT '';
