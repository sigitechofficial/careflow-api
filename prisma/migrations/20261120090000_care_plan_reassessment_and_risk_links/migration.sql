-- Final integration: reassessment review flags, care plan <-> IA risk links, risk supersede review.

-- Additive only; nothing existing is changed or closed. Idempotent.



DO $$ BEGIN
  CREATE TYPE "service_users"."CarePlanReassessmentChange" AS ENUM ('NEW_NEED', 'CHANGED_NEED', 'NO_LONGER_INDICATED', 'NEW_RISK', 'GENERAL');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "service_users"."CarePlanReviewFlagStatus" AS ENUM ('OPEN', 'RESOLVED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "service_users"."CarePlanRiskLinkStatus" AS ENUM ('LINKED', 'REVIEW_REQUIRED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "service_users"."InitialAssessmentRiskRecord" ADD COLUMN IF NOT EXISTS "supersedeReviewRequired" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS "supersededBySubmissionId" UUID;

CREATE TABLE IF NOT EXISTS "service_users"."CarePlanReassessmentFlag" (
    "id" UUID NOT NULL,
    "serviceUserId" UUID NOT NULL,
    "carePlanInstanceId" UUID NOT NULL,
    "triggeringSubmissionId" UUID NOT NULL,
    "previousSubmissionId" UUID,
    "changeTypes" "service_users"."CarePlanReassessmentChange"[],
    "reason" TEXT NOT NULL,
    "detailsJson" JSONB,
    "status" "service_users"."CarePlanReviewFlagStatus" NOT NULL DEFAULT 'OPEN',
    "resolvedById" UUID,
    "resolvedAt" TIMESTAMP(3),
    "resolutionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CarePlanReassessmentFlag_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "service_users"."CarePlanRiskLink" (
    "id" UUID NOT NULL,
    "serviceUserId" UUID NOT NULL,
    "carePlanInstanceId" UUID NOT NULL,
    "riskRecordId" UUID NOT NULL,
    "status" "service_users"."CarePlanRiskLinkStatus" NOT NULL DEFAULT 'LINKED',
    "riskSnapshotJson" JSONB NOT NULL,
    "reviewReason" TEXT,
    "linkedById" UUID,
    "linkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedById" UUID,
    "reviewedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CarePlanRiskLink_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "CarePlanReassessmentFlag_serviceUserId_idx" ON "service_users"."CarePlanReassessmentFlag"("serviceUserId");

CREATE INDEX IF NOT EXISTS "CarePlanReassessmentFlag_carePlanInstanceId_status_idx" ON "service_users"."CarePlanReassessmentFlag"("carePlanInstanceId", "status");

CREATE UNIQUE INDEX IF NOT EXISTS "CarePlanReassessmentFlag_carePlanInstanceId_triggeringSubmi_key" ON "service_users"."CarePlanReassessmentFlag"("carePlanInstanceId", "triggeringSubmissionId");

CREATE INDEX IF NOT EXISTS "CarePlanRiskLink_serviceUserId_idx" ON "service_users"."CarePlanRiskLink"("serviceUserId");

CREATE INDEX IF NOT EXISTS "CarePlanRiskLink_riskRecordId_idx" ON "service_users"."CarePlanRiskLink"("riskRecordId");

CREATE UNIQUE INDEX IF NOT EXISTS "CarePlanRiskLink_carePlanInstanceId_riskRecordId_key" ON "service_users"."CarePlanRiskLink"("carePlanInstanceId", "riskRecordId");

DO $$ BEGIN
  ALTER TABLE "service_users"."CarePlanReassessmentFlag" ADD CONSTRAINT "CarePlanReassessmentFlag_carePlanInstanceId_fkey" FOREIGN KEY ("carePlanInstanceId") REFERENCES "service_users"."ServiceUserCarePlanInstance"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "service_users"."CarePlanRiskLink" ADD CONSTRAINT "CarePlanRiskLink_carePlanInstanceId_fkey" FOREIGN KEY ("carePlanInstanceId") REFERENCES "service_users"."ServiceUserCarePlanInstance"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "service_users"."CarePlanRiskLink" ADD CONSTRAINT "CarePlanRiskLink_riskRecordId_fkey" FOREIGN KEY ("riskRecordId") REFERENCES "service_users"."InitialAssessmentRiskRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
