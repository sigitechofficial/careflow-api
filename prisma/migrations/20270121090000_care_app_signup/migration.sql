-- Care app sign-up and account deletion requests.
-- Existing employees were all made by the office (ADMIN); existing Care app accounts are APPROVED.
-- Additive only: new enums, columns with defaults, and one new table.

CREATE TYPE "employees"."EmployeeCreationSource" AS ENUM ('ADMIN', 'CARE_APP_SIGNUP');
CREATE TYPE "employees"."EmployeeAppApprovalStatus" AS ENUM ('APPROVED', 'PENDING', 'DECLINED');
CREATE TYPE "employees"."EmployeeAccountDeletionStatus" AS ENUM ('PENDING', 'APPROVED', 'DECLINED');

ALTER TABLE "employees"."Employee"
  ADD COLUMN "creationSource" "employees"."EmployeeCreationSource" NOT NULL DEFAULT 'ADMIN';
CREATE INDEX "Employee_creationSource_idx" ON "employees"."Employee"("creationSource");

ALTER TABLE "employees"."EmployeePortalAccount"
  ADD COLUMN "approvalStatus" "employees"."EmployeeAppApprovalStatus" NOT NULL DEFAULT 'APPROVED',
  ADD COLUMN "approvalDecidedAt" TIMESTAMP(3),
  ADD COLUMN "approvalDecidedById" UUID,
  ADD COLUMN "approvalNote" TEXT;

CREATE TABLE "employees"."EmployeeAccountDeletionRequest" (
    "id" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "employees"."EmployeeAccountDeletionStatus" NOT NULL DEFAULT 'PENDING',
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),
    "decidedById" UUID,
    "decisionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmployeeAccountDeletionRequest_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "EmployeeAccountDeletionRequest_employeeId_status_idx" ON "employees"."EmployeeAccountDeletionRequest"("employeeId", "status");
CREATE INDEX "EmployeeAccountDeletionRequest_status_idx" ON "employees"."EmployeeAccountDeletionRequest"("status");

ALTER TABLE "employees"."EmployeeAccountDeletionRequest"
  ADD CONSTRAINT "EmployeeAccountDeletionRequest_employeeId_fkey"
  FOREIGN KEY ("employeeId") REFERENCES "employees"."Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
