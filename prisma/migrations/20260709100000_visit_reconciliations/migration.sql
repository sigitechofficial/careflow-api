-- CreateEnum
CREATE TYPE "billing"."VisitReconciliationStatus" AS ENUM (
  'PENDING_REVIEW',
  'APPROVED_FOR_PAY',
  'APPROVED_FOR_INVOICE',
  'APPROVED_FOR_BOTH',
  'REJECTED_FOR_PAY',
  'REJECTED_FOR_INVOICE',
  'REQUIRES_MANAGER_APPROVAL',
  'LOCKED'
);

-- CreateEnum
CREATE TYPE "billing"."FinanceExceptionCode" AS ENUM (
  'MISSING_CHECK_IN',
  'MISSING_CHECK_OUT',
  'OVERRUN',
  'UNDERRUN',
  'GPS_MISMATCH',
  'RATE_MISSING',
  'CHARGE_CARD_MISSING',
  'PAY_CARD_MISSING',
  'TASKS_INCOMPLETE',
  'FUNDING_SETUP_INCOMPLETE',
  'PO_EXPIRED',
  'PO_MISSING'
);

-- CreateTable
CREATE TABLE "billing"."VisitReconciliation" (
  "id" UUID NOT NULL,
  "scheduledVisitId" UUID NOT NULL,
  "scheduledJobId" UUID NOT NULL,
  "serviceUserId" UUID NOT NULL,
  "employeeId" UUID,
  "jobAllocationId" UUID,
  "visitRef" TEXT NOT NULL,
  "plannedStartDateTime" TIMESTAMP(3) NOT NULL,
  "plannedEndDateTime" TIMESTAMP(3),
  "actualStartDateTime" TIMESTAMP(3),
  "actualEndDateTime" TIMESTAMP(3),
  "approvedPayStart" TIMESTAMP(3),
  "approvedPayEnd" TIMESTAMP(3),
  "approvedBillStart" TIMESTAMP(3),
  "approvedBillEnd" TIMESTAMP(3),
  "payableMinutes" INTEGER,
  "billableMinutes" INTEGER,
  "payableAmount" DECIMAL(12,2),
  "billableAmount" DECIMAL(12,2),
  "currency" TEXT NOT NULL DEFAULT 'GBP',
  "status" "billing"."VisitReconciliationStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
  "payCardId" UUID,
  "chargeCardId" UUID,
  "payCardSource" TEXT,
  "chargeCardSource" TEXT,
  "approvedById" UUID,
  "approvedAt" TIMESTAMP(3),
  "approvalNotes" TEXT,
  "lockedAt" TIMESTAMP(3),
  "lastEvaluatedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "VisitReconciliation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing"."FinanceException" (
  "id" UUID NOT NULL,
  "visitReconciliationId" UUID NOT NULL,
  "code" "billing"."FinanceExceptionCode" NOT NULL,
  "message" TEXT,
  "resolvedAt" TIMESTAMP(3),
  "resolvedById" UUID,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "FinanceException_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "VisitReconciliation_scheduledVisitId_key" ON "billing"."VisitReconciliation"("scheduledVisitId");

-- CreateIndex
CREATE INDEX "VisitReconciliation_scheduledJobId_idx" ON "billing"."VisitReconciliation"("scheduledJobId");

-- CreateIndex
CREATE INDEX "VisitReconciliation_serviceUserId_idx" ON "billing"."VisitReconciliation"("serviceUserId");

-- CreateIndex
CREATE INDEX "VisitReconciliation_employeeId_idx" ON "billing"."VisitReconciliation"("employeeId");

-- CreateIndex
CREATE INDEX "VisitReconciliation_status_idx" ON "billing"."VisitReconciliation"("status");

-- CreateIndex
CREATE INDEX "VisitReconciliation_plannedStartDateTime_idx" ON "billing"."VisitReconciliation"("plannedStartDateTime");

-- CreateIndex
CREATE INDEX "FinanceException_visitReconciliationId_idx" ON "billing"."FinanceException"("visitReconciliationId");

-- CreateIndex
CREATE INDEX "FinanceException_code_idx" ON "billing"."FinanceException"("code");

-- AddForeignKey
ALTER TABLE "billing"."FinanceException" ADD CONSTRAINT "FinanceException_visitReconciliationId_fkey" FOREIGN KEY ("visitReconciliationId") REFERENCES "billing"."VisitReconciliation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
