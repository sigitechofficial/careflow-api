-- Ensure check-in method columns exist on live, then default to GPS only.
ALTER TABLE "identity"."OrganisationGeneralSettings"
  ADD COLUMN IF NOT EXISTS "domCheckInGpsEnabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "domCheckInManualEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "domCheckInNfcEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "domCheckInQrEnabled" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "identity"."OrganisationGeneralSettings"
  ALTER COLUMN "domCheckInGpsEnabled" SET DEFAULT true,
  ALTER COLUMN "domCheckInManualEnabled" SET DEFAULT false,
  ALTER COLUMN "domCheckInNfcEnabled" SET DEFAULT false,
  ALTER COLUMN "domCheckInQrEnabled" SET DEFAULT false;

UPDATE "identity"."OrganisationGeneralSettings"
SET
  "domCheckInGpsEnabled" = true,
  "domCheckInManualEnabled" = false,
  "domCheckInNfcEnabled" = false,
  "domCheckInQrEnabled" = false;
