-- Learning: course versions carry their own completion / certificate rules (frozen at publish),
-- a practical competency link + checklist snapshot, learning objectives, and a WITHDRAWN
-- course status (no new assignments; carers already on the course continue).
-- Additive only. Existing versions are backfilled from their course.

ALTER TYPE "learning"."LearningCourseStatus" ADD VALUE IF NOT EXISTS 'WITHDRAWN';

ALTER TABLE "learning"."LearningCourseVersion"
  ADD COLUMN IF NOT EXISTS "requiresAssessment" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "requiresPracticalAssessment" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "requiresManagerApproval" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "certificateEnabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "learningObjectives" TEXT,
  ADD COLUMN IF NOT EXISTS "competencyId" UUID,
  ADD COLUMN IF NOT EXISTS "competencyChecklistSnapshot" JSONB;

-- Backfill: every existing version takes the rules its course has today.
UPDATE "learning"."LearningCourseVersion" v
SET "requiresAssessment" = c."requiresAssessment",
    "requiresPracticalAssessment" = c."requiresPracticalAssessment",
    "requiresManagerApproval" = c."requiresManagerApproval",
    "certificateEnabled" = c."certificateEnabled"
FROM "learning"."LearningCourse" c
WHERE c."id" = v."courseId";

CREATE INDEX IF NOT EXISTS "LearningCourseVersion_competencyId_idx"
  ON "learning"."LearningCourseVersion"("competencyId");

DO $$ BEGIN
  ALTER TABLE "learning"."LearningCourseVersion"
    ADD CONSTRAINT "LearningCourseVersion_competencyId_fkey"
    FOREIGN KEY ("competencyId") REFERENCES "learning"."LearningCompetency"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
