-- Idempotent: safe if a prior deploy partially applied this migration.

DO $$ BEGIN
  CREATE TYPE "service_users"."InitialAssessmentCarePlanRuleMatchMode" AS ENUM ('ANY', 'ALL');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "service_users"."InitialAssessmentCarePlanRecommendationRule" (
  "id" UUID NOT NULL,
  "carePathwayFormId" UUID NOT NULL,
  "label" TEXT,
  "matchMode" "service_users"."InitialAssessmentCarePlanRuleMatchMode" NOT NULL DEFAULT 'ANY',
  "conditions" JSONB NOT NULL,
  "suppressLegacyArea" TEXT,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deletedAt" TIMESTAMP(3),

  CONSTRAINT "InitialAssessmentCarePlanRecommendationRule_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "InitialAssessmentCarePlanRecommendationRule_carePathwayFormId_idx"
  ON "service_users"."InitialAssessmentCarePlanRecommendationRule"("carePathwayFormId");

CREATE INDEX IF NOT EXISTS "InitialAssessmentCarePlanRecommendationRule_isActive_idx"
  ON "service_users"."InitialAssessmentCarePlanRecommendationRule"("isActive");

CREATE INDEX IF NOT EXISTS "InitialAssessmentCarePlanRecommendationRule_deletedAt_idx"
  ON "service_users"."InitialAssessmentCarePlanRecommendationRule"("deletedAt");
