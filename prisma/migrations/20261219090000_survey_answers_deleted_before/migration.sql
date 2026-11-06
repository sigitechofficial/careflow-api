-- Survey roadmap Phase 2 part 7 follow-up: answers given before this were deleted under the retention period
-- (counted from each answer) while the survey kept later ones. Shown in Results; CQC evidence keeps earlier figures.
ALTER TABLE "surveys"."Survey" ADD COLUMN IF NOT EXISTS "answersDeletedBefore" TIMESTAMP(3);
