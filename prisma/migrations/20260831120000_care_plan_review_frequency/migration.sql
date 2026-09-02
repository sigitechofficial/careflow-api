-- Care Pathway review frequency (calendar months). Does not rewrite instance.nextReviewDueAt.
ALTER TABLE "care_pathway"."CarePathwayForm"
ADD COLUMN IF NOT EXISTS "reviewFrequencyMonths" INTEGER;

ALTER TABLE "care_pathway"."CarePathwayForm"
DROP CONSTRAINT IF EXISTS "CarePathwayForm_reviewFrequencyMonths_check";

ALTER TABLE "care_pathway"."CarePathwayForm"
ADD CONSTRAINT "CarePathwayForm_reviewFrequencyMonths_check"
CHECK ("reviewFrequencyMonths" IS NULL OR "reviewFrequencyMonths" IN (1, 2, 3, 6, 12));

-- Default existing care-plan templates to 6 months so new drafts have a pathway-driven date.
-- Published instance dates are left unchanged.
UPDATE "care_pathway"."CarePathwayForm"
SET "reviewFrequencyMonths" = 6
WHERE "formType" = 'CARE_PLAN'
  AND "deletedAt" IS NULL
  AND "reviewFrequencyMonths" IS NULL;

CREATE INDEX IF NOT EXISTS "ServiceUserCarePlanInstance_status_nextReviewDueAt_idx"
ON "service_users"."ServiceUserCarePlanInstance"("status", "nextReviewDueAt");
