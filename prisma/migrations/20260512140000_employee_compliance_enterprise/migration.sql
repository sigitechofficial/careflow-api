-- CreateEnum
CREATE TYPE "lookups"."ComplianceCategory" AS ENUM (
  'IDENTITY', 'RIGHT_TO_WORK', 'SAFEGUARDING', 'TRAINING', 'CLINICAL', 'EMPLOYMENT',
  'HEALTH_AND_SAFETY', 'PROFESSIONAL_REGISTRATION', 'DRIVING', 'OTHER'
);

-- CreateEnum
CREATE TYPE "employees"."EmployeeComplianceStatus" AS ENUM (
  'REQUIRED', 'SUBMITTED', 'PENDING_REVIEW', 'VALID', 'EXPIRING_SOON', 'EXPIRED',
  'REJECTED', 'MISSING', 'NOT_REQUIRED', 'NO_LONGER_REQUIRED'
);

-- CreateEnum
CREATE TYPE "employees"."ComplianceVerificationAction" AS ENUM (
  'SUBMITTED', 'VERIFIED', 'REJECTED', 'UPDATED', 'MARKED_NO_LONGER_REQUIRED',
  'DOCUMENT_UPLOADED', 'DOCUMENT_DELETED'
);

-- CreateEnum
CREATE TYPE "employees"."ComplianceReminderType" AS ENUM (
  'EXPIRY_90_DAYS', 'EXPIRY_60_DAYS', 'EXPIRY_30_DAYS', 'EXPIRY_7_DAYS', 'EXPIRED'
);

-- CreateEnum
CREATE TYPE "employees"."ComplianceReminderStatus" AS ENUM (
  'PENDING', 'SENT', 'FAILED', 'CANCELLED'
);

-- AlterTable ComplianceType
ALTER TABLE "lookups"."ComplianceType" ADD COLUMN "code" TEXT;
ALTER TABLE "lookups"."ComplianceType" ADD COLUMN "description" TEXT;
ALTER TABLE "lookups"."ComplianceType" ADD COLUMN "category" "lookups"."ComplianceCategory" NOT NULL DEFAULT 'OTHER';
ALTER TABLE "lookups"."ComplianceType" ADD COLUMN "hasExpiry" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "lookups"."ComplianceType" ADD COLUMN "defaultValidityMonths" INTEGER;
ALTER TABLE "lookups"."ComplianceType" ADD COLUMN "requiresDocument" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "lookups"."ComplianceType" ADD COLUMN "requiresVerification" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "lookups"."ComplianceType" ADD COLUMN "isMandatoryByDefault" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "lookups"."ComplianceType" ADD COLUMN "createdById" UUID;
ALTER TABLE "lookups"."ComplianceType" ADD COLUMN "updatedById" UUID;
ALTER TABLE "lookups"."ComplianceType" ADD COLUMN "deletedById" UUID;

CREATE UNIQUE INDEX "ComplianceType_code_key" ON "lookups"."ComplianceType"("code");
CREATE INDEX "ComplianceType_category_idx" ON "lookups"."ComplianceType"("category");

-- CreateTable ComplianceRequirement
CREATE TABLE "employees"."ComplianceRequirement" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "complianceTypeId" UUID NOT NULL,
    "roleId" UUID,
    "workAreaId" UUID,
    "jobTitleId" UUID,
    "contractTypeId" UUID,
    "locationId" UUID,
    "zoneId" UUID,
    "isMandatory" BOOLEAN NOT NULL DEFAULT true,
    "renewalBeforeDays" INTEGER NOT NULL DEFAULT 30,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdById" UUID,
    "updatedById" UUID,
    "deletedById" UUID,

    CONSTRAINT "ComplianceRequirement_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ComplianceRequirement_complianceTypeId_idx" ON "employees"."ComplianceRequirement"("complianceTypeId");
CREATE INDEX "ComplianceRequirement_deletedAt_idx" ON "employees"."ComplianceRequirement"("deletedAt");

ALTER TABLE "employees"."ComplianceRequirement" ADD CONSTRAINT "ComplianceRequirement_complianceTypeId_fkey" FOREIGN KEY ("complianceTypeId") REFERENCES "lookups"."ComplianceType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "employees"."ComplianceRequirement" ADD CONSTRAINT "ComplianceRequirement_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "lookups"."EmployeeRoleLookup"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "employees"."ComplianceRequirement" ADD CONSTRAINT "ComplianceRequirement_workAreaId_fkey" FOREIGN KEY ("workAreaId") REFERENCES "lookups"."WorkArea"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "employees"."ComplianceRequirement" ADD CONSTRAINT "ComplianceRequirement_jobTitleId_fkey" FOREIGN KEY ("jobTitleId") REFERENCES "lookups"."JobTitle"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "employees"."ComplianceRequirement" ADD CONSTRAINT "ComplianceRequirement_contractTypeId_fkey" FOREIGN KEY ("contractTypeId") REFERENCES "lookups"."ContractType"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "employees"."ComplianceRequirement" ADD CONSTRAINT "ComplianceRequirement_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "lookups"."Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "employees"."ComplianceRequirement" ADD CONSTRAINT "ComplianceRequirement_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "lookups"."Zone"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable EmployeeCompliance: convert status TEXT -> enum
ALTER TABLE "employees"."EmployeeCompliance" ADD COLUMN "requirementId" UUID;
ALTER TABLE "employees"."EmployeeCompliance" ADD COLUMN "submittedAt" TIMESTAMP(3);
ALTER TABLE "employees"."EmployeeCompliance" ADD COLUMN "verifiedAt" TIMESTAMP(3);
ALTER TABLE "employees"."EmployeeCompliance" ADD COLUMN "verifiedById" UUID;
ALTER TABLE "employees"."EmployeeCompliance" ADD COLUMN "rejectedAt" TIMESTAMP(3);
ALTER TABLE "employees"."EmployeeCompliance" ADD COLUMN "rejectedById" UUID;
ALTER TABLE "employees"."EmployeeCompliance" ADD COLUMN "rejectionReason" TEXT;
ALTER TABLE "employees"."EmployeeCompliance" ADD COLUMN "isNoLongerRequired" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "employees"."EmployeeCompliance" ADD COLUMN "noLongerRequiredReason" TEXT;
ALTER TABLE "employees"."EmployeeCompliance" ADD COLUMN "noLongerRequiredAt" TIMESTAMP(3);
ALTER TABLE "employees"."EmployeeCompliance" ADD COLUMN "noLongerRequiredById" UUID;

ALTER TABLE "employees"."EmployeeCompliance" ADD COLUMN "status_new" "employees"."EmployeeComplianceStatus" NOT NULL DEFAULT 'REQUIRED';

UPDATE "employees"."EmployeeCompliance" SET "status_new" = CASE
  WHEN "status" IS NULL THEN 'REQUIRED'::"employees"."EmployeeComplianceStatus"
  WHEN lower(trim("status")) IN ('valid', 'complete', 'completed') THEN 'VALID'::"employees"."EmployeeComplianceStatus"
  WHEN lower(trim("status")) IN ('expired') THEN 'EXPIRED'::"employees"."EmployeeComplianceStatus"
  WHEN lower(trim("status")) IN ('pending', 'pending_review', 'submitted') THEN 'PENDING_REVIEW'::"employees"."EmployeeComplianceStatus"
  WHEN lower(trim("status")) IN ('rejected') THEN 'REJECTED'::"employees"."EmployeeComplianceStatus"
  WHEN lower(trim("status")) IN ('missing') THEN 'MISSING'::"employees"."EmployeeComplianceStatus"
  ELSE 'REQUIRED'::"employees"."EmployeeComplianceStatus"
END;

ALTER TABLE "employees"."EmployeeCompliance" DROP COLUMN "status";
ALTER TABLE "employees"."EmployeeCompliance" RENAME COLUMN "status_new" TO "status";

CREATE INDEX "EmployeeCompliance_complianceTypeId_idx" ON "employees"."EmployeeCompliance"("complianceTypeId");
CREATE INDEX "EmployeeCompliance_requirementId_idx" ON "employees"."EmployeeCompliance"("requirementId");
CREATE INDEX "EmployeeCompliance_status_idx" ON "employees"."EmployeeCompliance"("status");

ALTER TABLE "employees"."EmployeeCompliance" ADD CONSTRAINT "EmployeeCompliance_requirementId_fkey" FOREIGN KEY ("requirementId") REFERENCES "employees"."ComplianceRequirement"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "employees"."EmployeeCompliance" ADD CONSTRAINT "EmployeeCompliance_verifiedById_fkey" FOREIGN KEY ("verifiedById") REFERENCES "identity"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "employees"."EmployeeCompliance" ADD CONSTRAINT "EmployeeCompliance_rejectedById_fkey" FOREIGN KEY ("rejectedById") REFERENCES "identity"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "employees"."EmployeeCompliance" ADD CONSTRAINT "EmployeeCompliance_noLongerRequiredById_fkey" FOREIGN KEY ("noLongerRequiredById") REFERENCES "identity"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable EmployeeComplianceDocument
CREATE TABLE "employees"."EmployeeComplianceDocument" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "employeeComplianceId" UUID NOT NULL,
    "fileName" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "mimeType" TEXT NOT NULL,
    "uploadedById" UUID,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "EmployeeComplianceDocument_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "EmployeeComplianceDocument_employeeComplianceId_idx" ON "employees"."EmployeeComplianceDocument"("employeeComplianceId");
CREATE INDEX "EmployeeComplianceDocument_deletedAt_idx" ON "employees"."EmployeeComplianceDocument"("deletedAt");

ALTER TABLE "employees"."EmployeeComplianceDocument" ADD CONSTRAINT "EmployeeComplianceDocument_employeeComplianceId_fkey" FOREIGN KEY ("employeeComplianceId") REFERENCES "employees"."EmployeeCompliance"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "employees"."EmployeeComplianceDocument" ADD CONSTRAINT "EmployeeComplianceDocument_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "identity"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable ComplianceVerification
CREATE TABLE "employees"."ComplianceVerification" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "employeeComplianceId" UUID NOT NULL,
    "action" "employees"."ComplianceVerificationAction" NOT NULL,
    "previousStatus" "employees"."EmployeeComplianceStatus",
    "newStatus" "employees"."EmployeeComplianceStatus" NOT NULL,
    "notes" TEXT,
    "performedById" UUID,
    "performedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata" JSONB,

    CONSTRAINT "ComplianceVerification_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ComplianceVerification_employeeComplianceId_idx" ON "employees"."ComplianceVerification"("employeeComplianceId");
CREATE INDEX "ComplianceVerification_performedAt_idx" ON "employees"."ComplianceVerification"("performedAt");

ALTER TABLE "employees"."ComplianceVerification" ADD CONSTRAINT "ComplianceVerification_employeeComplianceId_fkey" FOREIGN KEY ("employeeComplianceId") REFERENCES "employees"."EmployeeCompliance"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "employees"."ComplianceVerification" ADD CONSTRAINT "ComplianceVerification_performedById_fkey" FOREIGN KEY ("performedById") REFERENCES "identity"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable ComplianceReminder
CREATE TABLE "employees"."ComplianceReminder" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "employeeComplianceId" UUID NOT NULL,
    "reminderType" "employees"."ComplianceReminderType" NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "sentAt" TIMESTAMP(3),
    "status" "employees"."ComplianceReminderStatus" NOT NULL DEFAULT 'PENDING',
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ComplianceReminder_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ComplianceReminder_employeeComplianceId_idx" ON "employees"."ComplianceReminder"("employeeComplianceId");
CREATE INDEX "ComplianceReminder_dueDate_idx" ON "employees"."ComplianceReminder"("dueDate");
CREATE INDEX "ComplianceReminder_status_idx" ON "employees"."ComplianceReminder"("status");

ALTER TABLE "employees"."ComplianceReminder" ADD CONSTRAINT "ComplianceReminder_employeeComplianceId_fkey" FOREIGN KEY ("employeeComplianceId") REFERENCES "employees"."EmployeeCompliance"("id") ON DELETE CASCADE ON UPDATE CASCADE;
