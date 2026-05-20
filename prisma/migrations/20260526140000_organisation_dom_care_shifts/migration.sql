ALTER TABLE "identity"."OrganisationGeneralSettings"
  ADD COLUMN "domCareShiftDefinitions" JSONB NOT NULL DEFAULT '[]';
