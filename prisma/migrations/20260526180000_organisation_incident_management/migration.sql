ALTER TABLE "identity"."OrganisationGeneralSettings"
  ADD COLUMN "incidentDetailsEditableMinutes" INTEGER NOT NULL DEFAULT 60,
  ADD COLUMN "incidentDisplayHours" INTEGER NOT NULL DEFAULT 12,
  ADD COLUMN "incidentDefaultStatus" TEXT NOT NULL DEFAULT 'REPORTED',
  ADD COLUMN "incidentTypeSettings" JSONB NOT NULL DEFAULT '[]';
