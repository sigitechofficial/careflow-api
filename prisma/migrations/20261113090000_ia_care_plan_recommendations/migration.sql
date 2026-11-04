-- Additive only: persisted IA care plan recommendations. Idempotent.

DO $$ BEGIN
  CREATE TYPE "service_users"."InitialAssessmentCarePlanRecommendationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "service_users"."InitialAssessmentCarePlanRecommendation" (
  "id" UUID NOT NULL,
  "submissionId" UUID NOT NULL,
  "serviceUserId" UUID NOT NULL,
  "carePathwayFormId" UUID,
  "legacyRecommendationId" TEXT NOT NULL,
  "sourceType" TEXT NOT NULL,
  "evidenceJson" JSONB NOT NULL,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "status" "service_users"."InitialAssessmentCarePlanRecommendationStatus" NOT NULL DEFAULT 'PENDING',
  "decisionReason" TEXT,
  "decidedById" UUID,
  "decidedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "InitialAssessmentCarePlanRecommendation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "InitialAssessmentCarePlanRecommendation_submissionId_legacy_key"
  ON "service_users"."InitialAssessmentCarePlanRecommendation"("submissionId", "legacyRecommendationId");

CREATE INDEX IF NOT EXISTS "InitialAssessmentCarePlanRecommendation_serviceUserId_idx"
  ON "service_users"."InitialAssessmentCarePlanRecommendation"("serviceUserId");

CREATE INDEX IF NOT EXISTS "InitialAssessmentCarePlanRecommendation_carePathwayFormId_idx"
  ON "service_users"."InitialAssessmentCarePlanRecommendation"("carePathwayFormId");

DO $$ BEGIN
  ALTER TABLE "service_users"."InitialAssessmentCarePlanRecommendation"
    ADD CONSTRAINT "InitialAssessmentCarePlanRecommendation_submissionId_fkey"
    FOREIGN KEY ("submissionId") REFERENCES "service_users"."InitialAssessmentSubmission"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
