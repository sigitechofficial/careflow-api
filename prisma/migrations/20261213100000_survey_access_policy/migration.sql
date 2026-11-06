-- Per-survey access to individual responses and to results, and a reporting threshold
-- (src/surveys/survey-access.ts). Null keeps the ready-made default / today's behaviour.
ALTER TABLE "surveys"."Survey"
  ADD COLUMN IF NOT EXISTS "accessPolicy" JSONB,
  ADD COLUMN IF NOT EXISTS "reportingThreshold" INTEGER;
ALTER TABLE "surveys"."Survey" DROP CONSTRAINT IF EXISTS "Survey_reportingThreshold_range";
ALTER TABLE "surveys"."Survey" ADD CONSTRAINT "Survey_reportingThreshold_range" CHECK ("reportingThreshold" IS NULL OR "reportingThreshold" BETWEEN 1 AND 100);
