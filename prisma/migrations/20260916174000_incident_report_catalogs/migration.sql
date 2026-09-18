ALTER TABLE "identity"."OrganisationGeneralSettings"
  ADD COLUMN "incidentSeveritySettings" JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN "incidentWhoInformedSettings" JSONB NOT NULL DEFAULT '[]';
