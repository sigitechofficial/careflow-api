-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "billing"."BillingRateType" ADD VALUE 'OVERTIME';
ALTER TYPE "billing"."BillingRateType" ADD VALUE 'ON_CALL';
ALTER TYPE "billing"."BillingRateType" ADD VALUE 'TRAINING';
ALTER TYPE "billing"."BillingRateType" ADD VALUE 'LIVE_IN_DAILY';
ALTER TYPE "billing"."BillingRateType" ADD VALUE 'LIVE_IN_WEEKLY';

-- AlterTable
ALTER TABLE "billing"."PayrollRunLine" ADD COLUMN     "employeePayItemId" UUID,
ADD COLUMN     "sourceRef" TEXT,
ADD COLUMN     "sourceType" TEXT,
ALTER COLUMN "visitReconciliationId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "billing"."EmployeePayItem" (
    "id" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "wageTypeCode" TEXT NOT NULL,
    "workDate" DATE NOT NULL,
    "quantity" DECIMAL(10,2),
    "unit" TEXT,
    "rate" DECIMAL(12,4),
    "amount" DECIMAL(12,2) NOT NULL,
    "reason" TEXT NOT NULL,
    "notes" TEXT,
    "sourceType" TEXT NOT NULL DEFAULT 'MANUAL',
    "sourceId" UUID,
    "payCardId" UUID,
    "payCardVersion" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'PENDING_APPROVAL',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" UUID,
    "approvedAt" TIMESTAMP(3),
    "approvedById" UUID,
    "rejectedAt" TIMESTAMP(3),
    "rejectedById" UUID,
    "rejectionReason" TEXT,
    "includedInPayrollRunId" UUID,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmployeePayItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EmployeePayItem_employeeId_idx" ON "billing"."EmployeePayItem"("employeeId");

-- CreateIndex
CREATE INDEX "EmployeePayItem_status_idx" ON "billing"."EmployeePayItem"("status");

-- CreateIndex
CREATE INDEX "EmployeePayItem_workDate_idx" ON "billing"."EmployeePayItem"("workDate");

-- CreateIndex
CREATE INDEX "EmployeePayItem_includedInPayrollRunId_idx" ON "billing"."EmployeePayItem"("includedInPayrollRunId");

-- CreateIndex
CREATE INDEX "PayrollRunLine_sourceType_sourceRef_idx" ON "billing"."PayrollRunLine"("sourceType", "sourceRef");

-- CreateIndex
CREATE UNIQUE INDEX "PayrollRunLine_payrollRunId_employeePayItemId_key" ON "billing"."PayrollRunLine"("payrollRunId", "employeePayItemId");

-- AddForeignKey
ALTER TABLE "billing"."PayrollRunLine" ADD CONSTRAINT "PayrollRunLine_employeePayItemId_fkey" FOREIGN KEY ("employeePayItemId") REFERENCES "billing"."EmployeePayItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

