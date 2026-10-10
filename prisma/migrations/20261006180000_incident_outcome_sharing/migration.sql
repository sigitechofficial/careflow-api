-- Outcome & close: who the outcome was shared with (per person) and how learning reached the team.
ALTER TABLE "incidents"."IncidentOutcome"
  ADD COLUMN "outcomeSharing" JSONB,
  ADD COLUMN "learningSharedOn" DATE,
  ADD COLUMN "learningSharedMethod" VARCHAR(30),
  ADD COLUMN "learningSharedNote" TEXT;
