-- Body map enterprise: safeguarding checks, photos, audit actions

CREATE TYPE "service_users"."BodyMapPhotoConsentStatus" AS ENUM ('GRANTED', 'DENIED', 'PENDING');

ALTER TYPE "service_users"."BodyMapAuditAction" ADD VALUE IF NOT EXISTS 'SAFEGUARDING_CHECK';
ALTER TYPE "service_users"."BodyMapAuditAction" ADD VALUE IF NOT EXISTS 'ADD_PHOTO';

CREATE TABLE "service_users"."BodyMapSafeguardingCheck" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "bodyMapRecordId" UUID NOT NULL,
    "causeKnown" TEXT,
    "explanationConsistent" TEXT,
    "happenedBefore" TEXT,
    "immediateRisk" TEXT,
    "managerInformed" TEXT,
    "incidentRequired" TEXT,
    "referralRequired" TEXT,
    "referralReason" TEXT,
    "managerReviewRequired" BOOLEAN NOT NULL DEFAULT true,
    "managerNotes" TEXT,
    "checklistData" JSONB,
    "completedById" UUID,
    "completedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BodyMapSafeguardingCheck_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "service_users"."BodyMapPhoto" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "bodyMapRecordId" UUID NOT NULL,
    "fileName" TEXT NOT NULL,
    "originalName" TEXT,
    "fileUrl" TEXT NOT NULL,
    "fileSize" INTEGER,
    "mimeType" TEXT,
    "consentStatus" "service_users"."BodyMapPhotoConsentStatus" NOT NULL,
    "caption" TEXT,
    "uploadedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BodyMapPhoto_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BodyMapSafeguardingCheck_bodyMapRecordId_key" ON "service_users"."BodyMapSafeguardingCheck"("bodyMapRecordId");
CREATE INDEX "BodyMapSafeguardingCheck_bodyMapRecordId_idx" ON "service_users"."BodyMapSafeguardingCheck"("bodyMapRecordId");
CREATE INDEX "BodyMapPhoto_bodyMapRecordId_idx" ON "service_users"."BodyMapPhoto"("bodyMapRecordId");
CREATE INDEX "BodyMapRecord_managerReviewRequired_idx" ON "service_users"."BodyMapRecord"("managerReviewRequired");
CREATE INDEX "BodyMapRecord_safeguardingTriggered_idx" ON "service_users"."BodyMapRecord"("safeguardingTriggered");

ALTER TABLE "service_users"."BodyMapSafeguardingCheck" ADD CONSTRAINT "BodyMapSafeguardingCheck_bodyMapRecordId_fkey" FOREIGN KEY ("bodyMapRecordId") REFERENCES "service_users"."BodyMapRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "service_users"."BodyMapSafeguardingCheck" ADD CONSTRAINT "BodyMapSafeguardingCheck_completedById_fkey" FOREIGN KEY ("completedById") REFERENCES "identity"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "service_users"."BodyMapPhoto" ADD CONSTRAINT "BodyMapPhoto_bodyMapRecordId_fkey" FOREIGN KEY ("bodyMapRecordId") REFERENCES "service_users"."BodyMapRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "service_users"."BodyMapPhoto" ADD CONSTRAINT "BodyMapPhoto_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "identity"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
