-- Allow manual certificates without a linked assignment.
ALTER TABLE "learning"."LearningCertificate"
  ALTER COLUMN "assignmentId" DROP NOT NULL;

ALTER TABLE "learning"."LearningCertificate"
  ADD COLUMN IF NOT EXISTS "issueNotes" TEXT;
