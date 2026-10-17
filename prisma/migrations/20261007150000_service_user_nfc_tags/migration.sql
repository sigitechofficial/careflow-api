-- NFC tags fixed in a service user's home; scanned by carers at clock-in.
CREATE TABLE "service_users"."ServiceUserNfcTag" (
    "id" UUID NOT NULL,
    "serviceUserId" UUID NOT NULL,
    "uid" VARCHAR(32) NOT NULL,
    "label" VARCHAR(100) NOT NULL,
    "locationNote" VARCHAR(500),
    "status" VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    "statusReason" VARCHAR(500),
    "statusChangedAt" TIMESTAMP(3),
    "lastScannedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdById" UUID,
    "updatedById" UUID,
    "deletedById" UUID,

    CONSTRAINT "ServiceUserNfcTag_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ServiceUserNfcTag_serviceUserId_idx" ON "service_users"."ServiceUserNfcTag"("serviceUserId");
CREATE INDEX "ServiceUserNfcTag_uid_idx" ON "service_users"."ServiceUserNfcTag"("uid");
CREATE INDEX "ServiceUserNfcTag_deletedAt_idx" ON "service_users"."ServiceUserNfcTag"("deletedAt");

-- A physical tag can only be live on one service user at a time.
CREATE UNIQUE INDEX "ServiceUserNfcTag_uid_active_key"
  ON "service_users"."ServiceUserNfcTag"("uid")
  WHERE "status" = 'ACTIVE' AND "deletedAt" IS NULL;

ALTER TABLE "service_users"."ServiceUserNfcTag"
  ADD CONSTRAINT "ServiceUserNfcTag_serviceUserId_fkey" FOREIGN KEY ("serviceUserId")
  REFERENCES "service_users"."ServiceUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
