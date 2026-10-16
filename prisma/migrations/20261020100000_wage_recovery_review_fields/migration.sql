-- Sprint B4A: what the wage recovery and minimum wage review screens need to show and enforce.
-- Additive: three nullable columns and one new, empty table. No existing row is changed.
--  * WageRecovery.paidAmount / dueAmount: the original payment and what is now due.
--  * NmwPeriodAssessment.reviewOutcome: what a review found.
--  * WageRecoveryPolicy: the employer's statement that an approved recovery policy exists. None is
--    created here, so no authorised recovery is deducted until a person records one.
-- Rollback: drop the columns and the table.

-- AlterTable
ALTER TABLE "billing"."NmwPeriodAssessment" ADD COLUMN     "reviewOutcome" TEXT;

-- AlterTable
ALTER TABLE "billing"."WageRecovery" ADD COLUMN     "dueAmount" DECIMAL(12,2),
ADD COLUMN     "paidAmount" DECIMAL(12,2);

-- CreateTable
CREATE TABLE "billing"."WageRecoveryPolicy" (
    "id" UUID NOT NULL,
    "reference" TEXT NOT NULL,
    "recordedById" UUID,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "withdrawnById" UUID,
    "withdrawnAt" TIMESTAMP(3),
    "withdrawnNote" TEXT,

    CONSTRAINT "WageRecoveryPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WageRecoveryPolicy_withdrawnAt_idx" ON "billing"."WageRecoveryPolicy"("withdrawnAt");

