-- When enabled, blocked carers still appear in schedule carer pickers (marked as blocked).
ALTER TABLE "identity"."OrganisationGeneralSettings"
ADD COLUMN "domShowBlockedCarersInSchedule" BOOLEAN NOT NULL DEFAULT false;
