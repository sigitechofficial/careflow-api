-- Learning (16 Nov 2026): manager outcome for face to face / workplace courses, and "assigned again". Additive only.
ALTER TYPE "learning"."LearningAssignmentReviewKind" ADD VALUE 'OUTCOME_PASSED';
ALTER TYPE "learning"."LearningAssignmentReviewKind" ADD VALUE 'OUTCOME_NOT_PASSED';
ALTER TYPE "learning"."LearningAssignmentReviewKind" ADD VALUE 'ASSIGNED_AGAIN';
