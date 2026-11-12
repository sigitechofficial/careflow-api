-- One row per signed-in browser or phone, so signing in on one device no longer signs out the others.
CREATE TABLE IF NOT EXISTS "identity"."AuthSession" (
    "id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "accountId" UUID NOT NULL,
    "refreshTokenHash" TEXT NOT NULL,
    "userAgent" TEXT,
    "ipAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "revokedReason" TEXT,
    CONSTRAINT "AuthSession_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "AuthSession_kind_accountId_revokedAt_idx" ON "identity"."AuthSession"("kind", "accountId", "revokedAt");

-- How many devices: office website and Care app (0 = no limit; over the limit the oldest is signed out).
ALTER TABLE "identity"."OrganisationGeneralSettings" ADD COLUMN IF NOT EXISTS "appSettingMaxDevicesCareApp" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "identity"."OrganisationGeneralSettings" ADD COLUMN IF NOT EXISTS "officeMultipleDeviceLogin" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "identity"."OrganisationGeneralSettings" ADD COLUMN IF NOT EXISTS "officeMaxDevices" INTEGER NOT NULL DEFAULT 0;
