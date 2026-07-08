-- Pay card assignment targets (branch, role, employment type, worker type)
ALTER TABLE "billing"."PayCard"
  ADD COLUMN "assignmentTargetId" UUID,
  ADD COLUMN "assignmentTargetKey" TEXT;

CREATE INDEX "PayCard_assignmentLevel_assignmentTargetId_idx"
  ON "billing"."PayCard"("assignmentLevel", "assignmentTargetId");

CREATE INDEX "PayCard_assignmentLevel_assignmentTargetKey_idx"
  ON "billing"."PayCard"("assignmentLevel", "assignmentTargetKey");
