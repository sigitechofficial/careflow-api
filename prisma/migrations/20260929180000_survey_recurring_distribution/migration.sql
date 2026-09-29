-- Recurring survey distribution: template clones a new survey each period.

CREATE TYPE "surveys"."SurveyRecurrence" AS ENUM ('WEEKLY', 'MONTHLY', 'QUARTERLY', 'YEARLY');

ALTER TABLE "surveys"."Survey" ADD COLUMN IF NOT EXISTS "recurrence" "surveys"."SurveyRecurrence";
ALTER TABLE "surveys"."Survey" ADD COLUMN IF NOT EXISTS "clonedFromId" UUID;

CREATE INDEX IF NOT EXISTS "Survey_clonedFromId_idx" ON "surveys"."Survey"("clonedFromId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Survey_clonedFromId_fkey'
  ) THEN
    ALTER TABLE "surveys"."Survey"
      ADD CONSTRAINT "Survey_clonedFromId_fkey"
      FOREIGN KEY ("clonedFromId") REFERENCES "surveys"."Survey"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
