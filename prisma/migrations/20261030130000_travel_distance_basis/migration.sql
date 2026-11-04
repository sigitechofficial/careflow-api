-- Travel between visits worked out from the distance between the two addresses (default GAP = previous behaviour).
ALTER TABLE "identity"."OrganisationGeneralSettings" ADD COLUMN IF NOT EXISTS "travelPayBasis" VARCHAR(20) NOT NULL DEFAULT 'GAP';
ALTER TABLE "identity"."OrganisationGeneralSettings" ADD COLUMN IF NOT EXISTS "travelAverageSpeedMph" INTEGER NOT NULL DEFAULT 20;
ALTER TABLE "identity"."OrganisationGeneralSettings" ADD COLUMN IF NOT EXISTS "travelRoadFactor" DECIMAL(4,2) NOT NULL DEFAULT 1.3;
