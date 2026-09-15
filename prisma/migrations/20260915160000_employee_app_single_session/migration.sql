-- Org toggle: one active Care-app session per carer (default on).
-- Session activity fields so admin can see / revoke the current sign-in.

ALTER TABLE "identity"."OrganisationGeneralSettings"
  ADD COLUMN "appSettingSingleDeviceLoginCareApp" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "employees"."EmployeePortalAccount"
  ADD COLUMN "lastSeenAt" TIMESTAMP(3),
  ADD COLUMN "lastLoginIp" TEXT,
  ADD COLUMN "lastLoginUserAgent" TEXT;
