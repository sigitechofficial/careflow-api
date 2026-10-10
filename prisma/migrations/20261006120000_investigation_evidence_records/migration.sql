-- Investigation evidence (part A): records reviewed (+ links), evidence notes, outstanding evidence.
ALTER TABLE "incidents"."IncidentInvestigation"
  ADD COLUMN "recordsReviewed" TEXT[] DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "recordsReviewedDetails" JSONB,
  ADD COLUMN "evidenceNotes" TEXT,
  ADD COLUMN "outstandingEvidence" TEXT;
-- Existing rows get an empty list; new rows are written by the app (same as contributingFactors).
ALTER TABLE "incidents"."IncidentInvestigation" ALTER COLUMN "recordsReviewed" DROP DEFAULT;
