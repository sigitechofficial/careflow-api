ALTER TABLE "identity"."OrganisationGeneralSettings"
  ADD COLUMN "domCareAllocationRules" JSONB NOT NULL DEFAULT '[]';
