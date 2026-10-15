-- Per-tag scan history (accepted / wrong client / inactive) for the admin NFC tags tab.
CREATE TABLE "service_users"."ServiceUserNfcTagScan" (
    "id" UUID NOT NULL,
    "tagId" UUID NOT NULL,
    "scheduledJobId" UUID NOT NULL,
    "visitServiceUserId" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "result" VARCHAR(20) NOT NULL,
    "source" VARCHAR(20) NOT NULL,
    "scannedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ServiceUserNfcTagScan_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ServiceUserNfcTagScan_tagId_scannedAt_idx" ON "service_users"."ServiceUserNfcTagScan"("tagId", "scannedAt");

ALTER TABLE "service_users"."ServiceUserNfcTagScan"
  ADD CONSTRAINT "ServiceUserNfcTagScan_tagId_fkey" FOREIGN KEY ("tagId")
  REFERENCES "service_users"."ServiceUserNfcTag"("id") ON DELETE CASCADE ON UPDATE CASCADE;
