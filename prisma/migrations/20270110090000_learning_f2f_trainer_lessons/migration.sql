-- Learning (16 Nov 2026): face to face lessons marked by the trainer, and "passed, quiz to pass" outcome. Additive only.
ALTER TYPE "learning"."LearningAssignmentReviewKind" ADD VALUE 'OUTCOME_PASSED_AFTER_QUIZ';
ALTER TABLE "learning"."LearningContentItemCompletion" ADD COLUMN "markedById" UUID;
