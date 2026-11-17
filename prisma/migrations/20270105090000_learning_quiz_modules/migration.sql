-- Learning: quizzes can belong to a module (course section). NULL section = final assessment.
-- Additive: existing quizzes keep NULL and show as final assessments.

ALTER TABLE "learning"."LearningAssessment" ADD COLUMN IF NOT EXISTS "sectionId" UUID;
ALTER TABLE "learning"."LearningAssessment" ADD COLUMN IF NOT EXISTS "displayOrder" INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS "LearningAssessment_sectionId_idx" ON "learning"."LearningAssessment"("sectionId");

DO $$ BEGIN
  ALTER TABLE "learning"."LearningAssessment"
    ADD CONSTRAINT "LearningAssessment_sectionId_fkey"
    FOREIGN KEY ("sectionId") REFERENCES "learning"."LearningCourseSection"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
