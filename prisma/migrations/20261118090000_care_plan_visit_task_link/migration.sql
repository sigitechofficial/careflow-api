-- Phase 4A: manager-confirmed links between published care plans and existing visit task
-- assignments. Additive only; no existing table or row is changed. Idempotent.

DO $$ BEGIN
  CREATE TYPE "service_users"."CarePlanVisitTaskLinkStatus" AS ENUM ('LINKED', 'REVIEW_REQUIRED', 'NOT_APPLICABLE');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "service_users"."CarePlanVisitTaskLink" (
  "id" UUID NOT NULL,
  "serviceUserId" UUID NOT NULL,
  "carePlanInstanceId" UUID NOT NULL,
  "carePlanPublishedVersionId" UUID NOT NULL,
  "visitTaskAssignmentId" UUID,
  "requirementKey" TEXT NOT NULL DEFAULT '',
  "requirementLabel" TEXT,
  "status" "service_users"."CarePlanVisitTaskLinkStatus" NOT NULL DEFAULT 'LINKED',
  "reason" TEXT,
  "linkedById" UUID,
  "linkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reviewedById" UUID,
  "reviewedAt" TIMESTAMP(3),
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CarePlanVisitTaskLink_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "CarePlanVisitTaskLink_serviceUserId_idx"
  ON "service_users"."CarePlanVisitTaskLink"("serviceUserId");
CREATE INDEX IF NOT EXISTS "CarePlanVisitTaskLink_visitTaskAssignmentId_idx"
  ON "service_users"."CarePlanVisitTaskLink"("visitTaskAssignmentId");
CREATE INDEX IF NOT EXISTS "CarePlanVisitTaskLink_carePlanInstanceId_status_idx"
  ON "service_users"."CarePlanVisitTaskLink"("carePlanInstanceId", "status");
CREATE UNIQUE INDEX IF NOT EXISTS "CarePlanVisitTaskLink_carePlanInstanceId_visitTaskAssignmen_key"
  ON "service_users"."CarePlanVisitTaskLink"("carePlanInstanceId", "visitTaskAssignmentId", "requirementKey");

DO $$ BEGIN
  ALTER TABLE "service_users"."CarePlanVisitTaskLink" ADD CONSTRAINT "CarePlanVisitTaskLink_carePlanInstanceId_fkey"
    FOREIGN KEY ("carePlanInstanceId") REFERENCES "service_users"."ServiceUserCarePlanInstance"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "service_users"."CarePlanVisitTaskLink" ADD CONSTRAINT "CarePlanVisitTaskLink_carePlanPublishedVersionId_fkey"
    FOREIGN KEY ("carePlanPublishedVersionId") REFERENCES "service_users"."ServiceUserCarePlanPublishedVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "service_users"."CarePlanVisitTaskLink" ADD CONSTRAINT "CarePlanVisitTaskLink_visitTaskAssignmentId_fkey"
    FOREIGN KEY ("visitTaskAssignmentId") REFERENCES "service_users"."ServiceUserVisitTaskAssignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
