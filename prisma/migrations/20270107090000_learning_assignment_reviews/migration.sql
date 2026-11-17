-- Learning (16 Nov 2026): late completion flag and office reviews of overdue / late assignments. Additive only.
ALTER TABLE "learning"."LearningAssignment" ADD COLUMN "completedLate" BOOLEAN NOT NULL DEFAULT false;

CREATE TYPE "learning"."LearningAssignmentReviewKind" AS ENUM ('EXTENDED', 'REASON', 'NOT_COMPLETED');

CREATE TABLE "learning"."LearningAssignmentReview" (
    "id" UUID NOT NULL,
    "assignmentId" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "kind" "learning"."LearningAssignmentReviewKind" NOT NULL,
    "reasonCode" TEXT,
    "actionCodes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "note" TEXT,
    "previousDueAt" TIMESTAMP(3),
    "newDueAt" TIMESTAMP(3),
    "followUpAt" TIMESTAMP(3),
    "policyVersionId" UUID,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LearningAssignmentReview_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "LearningAssignmentReview_assignmentId_idx" ON "learning"."LearningAssignmentReview"("assignmentId");
CREATE INDEX "LearningAssignmentReview_employeeId_idx" ON "learning"."LearningAssignmentReview"("employeeId");
CREATE INDEX "LearningAssignmentReview_kind_idx" ON "learning"."LearningAssignmentReview"("kind");

ALTER TABLE "learning"."LearningAssignmentReview"
  ADD CONSTRAINT "LearningAssignmentReview_assignmentId_fkey"
  FOREIGN KEY ("assignmentId") REFERENCES "learning"."LearningAssignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
