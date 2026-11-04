-- On/off switch for paying the gap between visits automatically (default on = previous behaviour).
ALTER TABLE "identity"."OrganisationGeneralSettings" ADD COLUMN IF NOT EXISTS "travelGapPayEnabled" BOOLEAN NOT NULL DEFAULT true;
