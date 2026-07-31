-- CreateEnum
CREATE TYPE "billing"."EmployeePayoutBatchStatus" AS ENUM ('DRAFT', 'APPROVED', 'PAID', 'CANCELLED');

-- CreateEnum
CREATE TYPE "billing"."EmployeePayoutLineStatus" AS ENUM ('PENDING', 'PAID', 'SKIPPED');

-- CreateTable
CREATE TABLE "billing"."EmployeePayoutBatch" (
    "id" UUID NOT NULL,
    "periodKey" TEXT NOT NULL,
    "periodStart" DATE NOT NULL,
    "periodEnd" DATE NOT NULL,
    "status" "billing"."EmployeePayoutBatchStatus" NOT NULL DEFAULT 'DRAFT',
    "currency" TEXT NOT NULL DEFAULT 'GBP',
    "totalAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" UUID,
    "approvedById" UUID,
    "approvedAt" TIMESTAMP(3),
    "paidById" UUID,
    "paidAt" TIMESTAMP(3),

    CONSTRAINT "EmployeePayoutBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing"."EmployeePayoutLine" (
    "id" UUID NOT NULL,
    "batchId" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "status" "billing"."EmployeePayoutLineStatus" NOT NULL DEFAULT 'PENDING',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmployeePayoutLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EmployeePayoutBatch_periodKey_idx" ON "billing"."EmployeePayoutBatch"("periodKey");

-- CreateIndex
CREATE INDEX "EmployeePayoutBatch_status_idx" ON "billing"."EmployeePayoutBatch"("status");

-- CreateIndex
CREATE INDEX "EmployeePayoutBatch_periodStart_periodEnd_idx" ON "billing"."EmployeePayoutBatch"("periodStart", "periodEnd");

-- CreateIndex
CREATE INDEX "EmployeePayoutLine_batchId_idx" ON "billing"."EmployeePayoutLine"("batchId");

-- CreateIndex
CREATE INDEX "EmployeePayoutLine_employeeId_idx" ON "billing"."EmployeePayoutLine"("employeeId");

-- CreateIndex
CREATE INDEX "EmployeePayoutLine_status_idx" ON "billing"."EmployeePayoutLine"("status");

-- CreateIndex
CREATE UNIQUE INDEX "EmployeePayoutLine_batchId_employeeId_key" ON "billing"."EmployeePayoutLine"("batchId", "employeeId");

-- AddForeignKey
ALTER TABLE "billing"."EmployeePayoutLine" ADD CONSTRAINT "EmployeePayoutLine_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "billing"."EmployeePayoutBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
