-- Sprint B3: wage recoveries, and minimum wage assessments made by a UK payroll run.
-- Additive: one new table (WageRecovery, empty), five nullable columns and one unique index on
-- NmwPeriodAssessment. Two existing columns of NmwPeriodAssessment become nullable (payrollRunId,
-- compliant): no stored value changes, and every existing row keeps both.
-- Rollback: drop the table, the columns and the index; restoring NOT NULL needs rows without a
-- visit pay run or without a compliance result to be removed first, which loses evidence.

-- AlterTable
ALTER TABLE "billing"."NmwPeriodAssessment" ADD COLUMN     "issue" TEXT,
ADD COLUMN     "resolutionNote" TEXT,
ADD COLUMN     "resolvedAt" TIMESTAMP(3),
ADD COLUMN     "resolvedById" UUID,
ADD COLUMN     "shortfall" DECIMAL(12,2),
ADD COLUMN     "ukPayrollRunId" UUID,
ALTER COLUMN "payrollRunId" DROP NOT NULL,
ALTER COLUMN "compliant" DROP NOT NULL;

-- CreateTable
CREATE TABLE "billing"."WageRecovery" (
    "id" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "subjectKey" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "reason" TEXT NOT NULL,
    "originalReference" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PROPOSED',
    "authorityBasis" TEXT,
    "decisionNote" TEXT,
    "detectedInRunId" UUID,
    "detectedById" UUID,
    "decidedById" UUID,
    "decidedAt" TIMESTAMP(3),
    "appliedInRunId" UUID,
    "appliedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WageRecovery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WageRecovery_subjectKey_key" ON "billing"."WageRecovery"("subjectKey");

-- CreateIndex
CREATE INDEX "WageRecovery_employeeId_idx" ON "billing"."WageRecovery"("employeeId");

-- CreateIndex
CREATE INDEX "WageRecovery_status_idx" ON "billing"."WageRecovery"("status");

-- CreateIndex
CREATE INDEX "WageRecovery_detectedInRunId_idx" ON "billing"."WageRecovery"("detectedInRunId");

-- CreateIndex
CREATE UNIQUE INDEX "NmwPeriodAssessment_ukPayrollRunId_employeeId_periodStart_key" ON "billing"."NmwPeriodAssessment"("ukPayrollRunId", "employeeId", "periodStart");

