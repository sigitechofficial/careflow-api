-- AlterTable: Add carer-app incident fields that were not previously mirrored to the register
ALTER TABLE "incidents"."Incident"
  ADD COLUMN "injuryDetails" TEXT,
  ADD COLUMN "peopleInvolved" TEXT,
  ADD COLUMN "whoInformedKeys" TEXT[] DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "carerSafeguardingConcern" BOOLEAN,
  ADD COLUMN "followUpRequired" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "emergencyServicesDetails" TEXT,
  ADD COLUMN "familyInformed" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "carerNotes" TEXT;

-- AlterTable: Add caption to incident attachments
ALTER TABLE "incidents"."IncidentAttachment"
  ADD COLUMN "caption" TEXT;
