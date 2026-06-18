-- Service user document store (1G) — replaces folder-documents experiment

CREATE TYPE "service_users"."ServiceUserDocumentAccessLevel" AS ENUM (
  'MANAGER_ONLY',
  'COORDINATOR_MANAGER',
  'CARER_SUMMARY',
  'ALL_USERS'
);

CREATE TYPE "service_users"."ServiceUserDocumentRecordStatus" AS ENUM (
  'ACTIVE',
  'SUPERSEDED',
  'EXPIRED',
  'REQUESTED',
  'NOT_APPLICABLE'
);

CREATE TYPE "service_users"."ServiceUserDnacprStatusConfirmation" AS ENUM (
  'UNKNOWN',
  'IN_PLACE',
  'NOT_IN_PLACE'
);

CREATE TYPE "service_users"."ServiceUserLpaStatusConfirmation" AS ENUM (
  'UNKNOWN',
  'IN_FORCE',
  'NOT_IN_FORCE',
  'NONE'
);

ALTER TABLE "service_users"."ServiceUserLegalDocument"
  ADD COLUMN IF NOT EXISTS "dnacprStatusConfirmation" "service_users"."ServiceUserDnacprStatusConfirmation" NOT NULL DEFAULT 'UNKNOWN',
  ADD COLUMN IF NOT EXISTS "dnacprPhysicalLocation" TEXT,
  ADD COLUMN IF NOT EXISTS "lpaStatusConfirmation" "service_users"."ServiceUserLpaStatusConfirmation" NOT NULL DEFAULT 'UNKNOWN';

DROP TABLE IF EXISTS "service_users"."ServiceUserFolderDocument";
DROP TABLE IF EXISTS "lookups"."ServiceUserDocumentRegularityType";
DROP TABLE IF EXISTS "lookups"."ServiceUserDocumentType";

CREATE TABLE "lookups"."ServiceUserDocumentTypeCatalog" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "physicalLocationInHomeRequired" BOOLEAN NOT NULL DEFAULT false,
    "expiryTrackingRequired" BOOLEAN NOT NULL DEFAULT false,
    "defaultAccessLevel" "service_users"."ServiceUserDocumentAccessLevel" NOT NULL,
    "requiredBeforeFirstVisit" BOOLEAN NOT NULL DEFAULT false,
    "blocksCarePlanApprovalIfMissing" BOOLEAN NOT NULL DEFAULT false,
    "expiryAlertDays" INTEGER,
    "cqcLegalStandard" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "ServiceUserDocumentTypeCatalog_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ServiceUserDocumentTypeCatalog_code_key" ON "lookups"."ServiceUserDocumentTypeCatalog"("code");
CREATE INDEX "ServiceUserDocumentTypeCatalog_deletedAt_idx" ON "lookups"."ServiceUserDocumentTypeCatalog"("deletedAt");
CREATE INDEX "ServiceUserDocumentTypeCatalog_sortOrder_idx" ON "lookups"."ServiceUserDocumentTypeCatalog"("sortOrder");

CREATE TABLE "service_users"."ServiceUserDocumentRecord" (
    "id" UUID NOT NULL,
    "serviceUserId" UUID NOT NULL,
    "documentTypeId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "documentDate" TIMESTAMP(3) NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "uploadedById" UUID,
    "supersedesDocumentId" UUID,
    "expiryDate" TIMESTAMP(3),
    "physicalLocationInHome" TEXT,
    "accessLevel" "service_users"."ServiceUserDocumentAccessLevel" NOT NULL,
    "status" "service_users"."ServiceUserDocumentRecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "linkedRecordType" TEXT,
    "linkedRecordId" UUID,
    "notes" TEXT,
    "fileUrl" TEXT,
    "fileName" TEXT,
    "fileSize" INTEGER,
    "mimeType" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdById" UUID,
    "updatedById" UUID,
    "deletedById" UUID,

    CONSTRAINT "ServiceUserDocumentRecord_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ServiceUserDocumentRecord_supersedesDocumentId_key" ON "service_users"."ServiceUserDocumentRecord"("supersedesDocumentId");
CREATE INDEX "ServiceUserDocumentRecord_serviceUserId_idx" ON "service_users"."ServiceUserDocumentRecord"("serviceUserId");
CREATE INDEX "ServiceUserDocumentRecord_documentTypeId_idx" ON "service_users"."ServiceUserDocumentRecord"("documentTypeId");
CREATE INDEX "ServiceUserDocumentRecord_status_idx" ON "service_users"."ServiceUserDocumentRecord"("status");
CREATE INDEX "ServiceUserDocumentRecord_deletedAt_idx" ON "service_users"."ServiceUserDocumentRecord"("deletedAt");

ALTER TABLE "service_users"."ServiceUserDocumentRecord" ADD CONSTRAINT "ServiceUserDocumentRecord_serviceUserId_fkey" FOREIGN KEY ("serviceUserId") REFERENCES "service_users"."ServiceUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "service_users"."ServiceUserDocumentRecord" ADD CONSTRAINT "ServiceUserDocumentRecord_documentTypeId_fkey" FOREIGN KEY ("documentTypeId") REFERENCES "lookups"."ServiceUserDocumentTypeCatalog"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "service_users"."ServiceUserDocumentRecord" ADD CONSTRAINT "ServiceUserDocumentRecord_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "identity"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "service_users"."ServiceUserDocumentRecord" ADD CONSTRAINT "ServiceUserDocumentRecord_supersedesDocumentId_fkey" FOREIGN KEY ("supersedesDocumentId") REFERENCES "service_users"."ServiceUserDocumentRecord"("id") ON DELETE SET NULL ON UPDATE CASCADE;
