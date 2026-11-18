-- Carer app learning (13 Nov 2026): link a session attendee to the carer's assignment,
-- and record "Can't attend" from the app. Additive only.
ALTER TABLE "learning"."LearningTrainingEventAttendee"
  ADD COLUMN "assignmentId" UUID,
  ADD COLUMN "cantAttendReason" TEXT,
  ADD COLUMN "cantAttendAt" TIMESTAMP(3);

CREATE INDEX "LearningTrainingEventAttendee_assignmentId_idx"
  ON "learning"."LearningTrainingEventAttendee"("assignmentId");

ALTER TABLE "learning"."LearningTrainingEventAttendee"
  ADD CONSTRAINT "LearningTrainingEventAttendee_assignmentId_fkey"
  FOREIGN KEY ("assignmentId") REFERENCES "learning"."LearningAssignment"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
