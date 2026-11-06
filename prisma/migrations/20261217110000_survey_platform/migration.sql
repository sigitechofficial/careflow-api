-- Survey roadmap Phase 2 part 7: platform items. See src/surveys/survey-platform.service.ts.
-- A repeating survey skips these months (1-12, organisation time); empty = none skipped.
ALTER TABLE "surveys"."Survey" ADD COLUMN IF NOT EXISTS "recurrenceSkipMonths" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[];
-- A repeating survey's bank of rotating questions (its own question ids): each period asks one of them, in turn.
ALTER TABLE "surveys"."Survey" ADD COLUMN IF NOT EXISTS "rotatingQuestionIds" UUID[] NOT NULL DEFAULT ARRAY[]::UUID[];
-- Months after closing that answers are kept (null = the ready-made survey's privacy notice, else kept).
ALTER TABLE "surveys"."Survey" ADD COLUMN IF NOT EXISTS "answerRetentionMonths" INTEGER;
-- When this survey's (or period's) answers were deleted under the retention period.
ALTER TABLE "surveys"."Survey" ADD COLUMN IF NOT EXISTS "answersDeletedAt" TIMESTAMP(3);
-- A copy sent after a Learning training session (training feedback): the session it is about.
ALTER TABLE "surveys"."Survey" ADD COLUMN IF NOT EXISTS "trainingEventId" UUID;
CREATE INDEX IF NOT EXISTS "Survey_trainingEventId_idx" ON "surveys"."Survey"("trainingEventId");
-- Grouped answer choices: [{ heading, options }] shown to people answering and reported by group.
ALTER TABLE "surveys"."SurveyQuestion" ADD COLUMN IF NOT EXISTS "optionGroups" JSONB;
