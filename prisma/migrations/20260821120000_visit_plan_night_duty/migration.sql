-- Night duty on visit-plan slots (sleeping night vs waking night). Copied onto generated jobs as metadata.
CREATE TYPE "service_users"."VisitPlanNightDuty" AS ENUM ('NONE', 'SLEEPING_NIGHT', 'WAKING_NIGHT');

ALTER TABLE "service_users"."VisitPlanSlot"
ADD COLUMN "nightDuty" "service_users"."VisitPlanNightDuty" NOT NULL DEFAULT 'NONE';
