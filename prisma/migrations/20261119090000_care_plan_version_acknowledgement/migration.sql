-- Phase 4B: carer notification claim + acknowledgement per published care plan version.
-- Additive only; no existing table or row is changed. Idempotent.

CREATE TABLE IF NOT EXISTS "service_users"."CarePlanVersionAcknowledgement" (
  "id" UUID NOT NULL,
  "publishedVersionId" UUID NOT NULL,
  "carePlanInstanceId" UUID NOT NULL,
  "serviceUserId" UUID NOT NULL,
  "employeeId" UUID NOT NULL,
  "notifiedAt" TIMESTAMP(3),
  "acknowledgedAt" TIMESTAMP(3),
  "acknowledgedById" UUID,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CarePlanVersionAcknowledgement_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "CarePlanVersionAcknowledgement_employeeId_idx"
  ON "service_users"."CarePlanVersionAcknowledgement"("employeeId");
CREATE INDEX IF NOT EXISTS "CarePlanVersionAcknowledgement_carePlanInstanceId_idx"
  ON "service_users"."CarePlanVersionAcknowledgement"("carePlanInstanceId");
CREATE UNIQUE INDEX IF NOT EXISTS "CarePlanVersionAcknowledgement_publishedVersionId_employeeI_key"
  ON "service_users"."CarePlanVersionAcknowledgement"("publishedVersionId", "employeeId");

DO $$ BEGIN
  ALTER TABLE "service_users"."CarePlanVersionAcknowledgement" ADD CONSTRAINT "CarePlanVersionAcknowledgement_publishedVersionId_fkey"
    FOREIGN KEY ("publishedVersionId") REFERENCES "service_users"."ServiceUserCarePlanPublishedVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "service_users"."CarePlanVersionAcknowledgement" ADD CONSTRAINT "CarePlanVersionAcknowledgement_carePlanInstanceId_fkey"
    FOREIGN KEY ("carePlanInstanceId") REFERENCES "service_users"."ServiceUserCarePlanInstance"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
