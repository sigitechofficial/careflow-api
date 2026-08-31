-- HR Phase 1: workforce profile extension + document workflow fields

CREATE TYPE "employees"."CareWorkforceCategory" AS ENUM (
  'NEW_TO_CARE',
  'CARE_OR_SUPPORT_WORKER',
  'SUPERVISOR_OR_LEADER',
  'PRACTITIONER',
  'DEPUTY_MANAGER',
  'REGISTERED_MANAGER',
  'NON_DIRECT_CARE'
);

CREATE TYPE "employees"."EmployeeLifecycleStatus" AS ENUM (
  'PRE_EMPLOYMENT',
  'CLEARED',
  'ONBOARDING',
  'ACTIVE',
  'ACTIVE_PAUSED',
  'LEAVING',
  'LEFT',
  'ALUMNI'
);

CREATE TYPE "employees"."HrDeploymentStatus" AS ENUM (
  'GREEN',
  'AMBER',
  'RED'
);

CREATE TYPE "employees"."HrDocumentType" AS ENUM (
  'ID_DOCUMENT',
  'CONTRACT',
  'QUALIFICATION',
  'CERTIFICATE',
  'OTHER'
);

CREATE TYPE "employees"."HrDocumentStatus" AS ENUM (
  'PENDING',
  'APPROVED',
  'REJECTED'
);

CREATE TABLE "employees"."EmployeeHRProfile" (
  "id" UUID NOT NULL,
  "employeeId" UUID NOT NULL,
  "legalName" TEXT,
  "preferredName" TEXT,
  "careWorkforceCategory" "employees"."CareWorkforceCategory",
  "employeeLifecycleStatus" "employees"."EmployeeLifecycleStatus" NOT NULL DEFAULT 'ACTIVE',
  "deploymentStatus" "employees"."HrDeploymentStatus" NOT NULL DEFAULT 'GREEN',
  "reportingManagerId" UUID,
  "branchTeam" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "deletedAt" TIMESTAMP(3),
  "createdById" UUID,
  "updatedById" UUID,

  CONSTRAINT "EmployeeHRProfile_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EmployeeHRProfile_employeeId_key" ON "employees"."EmployeeHRProfile"("employeeId");
CREATE INDEX "EmployeeHRProfile_employeeId_idx" ON "employees"."EmployeeHRProfile"("employeeId");
CREATE INDEX "EmployeeHRProfile_reportingManagerId_idx" ON "employees"."EmployeeHRProfile"("reportingManagerId");
CREATE INDEX "EmployeeHRProfile_employeeLifecycleStatus_idx" ON "employees"."EmployeeHRProfile"("employeeLifecycleStatus");
CREATE INDEX "EmployeeHRProfile_deploymentStatus_idx" ON "employees"."EmployeeHRProfile"("deploymentStatus");
CREATE INDEX "EmployeeHRProfile_deletedAt_idx" ON "employees"."EmployeeHRProfile"("deletedAt");

ALTER TABLE "employees"."EmployeeHRProfile"
  ADD CONSTRAINT "EmployeeHRProfile_employeeId_fkey"
  FOREIGN KEY ("employeeId") REFERENCES "employees"."Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "employees"."EmployeeHRProfile"
  ADD CONSTRAINT "EmployeeHRProfile_reportingManagerId_fkey"
  FOREIGN KEY ("reportingManagerId") REFERENCES "employees"."Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "employees"."EmployeeDocument"
  ADD COLUMN "documentType" "employees"."HrDocumentType",
  ADD COLUMN "expiryDate" TIMESTAMP(3),
  ADD COLUMN "status" "employees"."HrDocumentStatus";

CREATE INDEX "EmployeeDocument_documentType_idx" ON "employees"."EmployeeDocument"("documentType");
CREATE INDEX "EmployeeDocument_status_idx" ON "employees"."EmployeeDocument"("status");

-- Backfill HR profiles for all active employees
INSERT INTO "employees"."EmployeeHRProfile" (
  "id",
  "employeeId",
  "employeeLifecycleStatus",
  "deploymentStatus",
  "isActive",
  "createdAt",
  "updatedAt"
)
SELECT
  gen_random_uuid(),
  e."id",
  'ACTIVE'::"employees"."EmployeeLifecycleStatus",
  'GREEN'::"employees"."HrDeploymentStatus",
  true,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "employees"."Employee" e
WHERE e."deletedAt" IS NULL
  AND NOT EXISTS (
    SELECT 1
    FROM "employees"."EmployeeHRProfile" p
    WHERE p."employeeId" = e."id"
  );
