-- Additive only: link an accepted IA care plan recommendation to its care plan instance. Idempotent.

ALTER TABLE "service_users"."InitialAssessmentCarePlanRecommendation"
  ADD COLUMN IF NOT EXISTS "carePlanInstanceId" UUID;

CREATE INDEX IF NOT EXISTS "InitialAssessmentCarePlanRecommendation_carePlanInstanceId_idx"
  ON "service_users"."InitialAssessmentCarePlanRecommendation"("carePlanInstanceId");
