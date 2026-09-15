-- Single-device Care-app login is opt-in (default off).

ALTER TABLE "identity"."OrganisationGeneralSettings"
  ALTER COLUMN "appSettingSingleDeviceLoginCareApp" SET DEFAULT false;

UPDATE "identity"."OrganisationGeneralSettings"
SET "appSettingSingleDeviceLoginCareApp" = false
WHERE "appSettingSingleDeviceLoginCareApp" = true;
