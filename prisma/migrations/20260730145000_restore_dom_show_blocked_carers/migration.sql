-- Restore setting accidentally dropped by learning_module_foundation migration.
ALTER TABLE "identity"."OrganisationGeneralSettings"
    ADD COLUMN IF NOT EXISTS "domShowBlockedCarersInSchedule" BOOLEAN NOT NULL DEFAULT false;
