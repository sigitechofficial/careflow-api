-- Organisation limits for paid waiting / travel time between visits (defaults = previous fixed values).
ALTER TABLE "identity"."OrganisationGeneralSettings" ADD COLUMN IF NOT EXISTS "travelWaitingGapMinutes" INTEGER NOT NULL DEFAULT 15;
ALTER TABLE "identity"."OrganisationGeneralSettings" ADD COLUMN IF NOT EXISTS "travelBreakGapMinutes" INTEGER NOT NULL DEFAULT 60;
ALTER TABLE "identity"."OrganisationGeneralSettings" ADD COLUMN IF NOT EXISTS "travelWentHomeGapMinutes" INTEGER NOT NULL DEFAULT 90;
