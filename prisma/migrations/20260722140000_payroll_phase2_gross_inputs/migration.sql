-- Phase 2: UK payroll gross input snapshots (additive).

ALTER TYPE "payroll"."UkPayrollRunStatus" ADD VALUE IF NOT EXISTS 'GROSS_CALCULATED';

CREATE TYPE "payroll"."UkPayrollInputSourceType" AS ENUM (
  'BILLING_PAYROLL_LINE',
  'VISIT_RECONCILIATION',
  'PAY_AGREEMENT_SALARY',
  'SALARY_DEDUCTION'
);

ALTER TABLE "payroll"."UkPayrollRun"
  ADD COLUMN IF NOT EXISTS "totalGross" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "totalExpenses" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "grossCalculatedAt" TIMESTAMP(3);

ALTER TABLE "payroll"."UkPayrollRunEmployee"
  ADD COLUMN IF NOT EXISTS "visitPay" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "salaryPay" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "travelPay" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "nmwTopUp" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "otherPay" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "expenseTotal" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "deductionTotal" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "totalGross" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "inputLineCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "hasProvisionalInputs" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "grossCalculatedAt" TIMESTAMP(3);

CREATE TABLE "payroll"."UkPayrollInputLine" (
  "id" UUID NOT NULL,
  "runId" UUID NOT NULL,
  "runEmployeeId" UUID NOT NULL,
  "employeeId" UUID NOT NULL,
  "sourceType" "payroll"."UkPayrollInputSourceType" NOT NULL,
  "sourcePayrollRunId" UUID,
  "sourcePayrollRunLineId" UUID,
  "sourceVisitReconciliationId" UUID,
  "sourceSalaryDeductionId" UUID,
  "lineType" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "minutes" INTEGER,
  "amount" DECIMAL(12,2) NOT NULL,
  "isExpense" BOOLEAN NOT NULL DEFAULT false,
  "isProvisional" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UkPayrollInputLine_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "UkPayrollInputLine_sourcePayrollRunLineId_key"
  ON "payroll"."UkPayrollInputLine"("sourcePayrollRunLineId");
CREATE INDEX "UkPayrollInputLine_runId_idx" ON "payroll"."UkPayrollInputLine"("runId");
CREATE INDEX "UkPayrollInputLine_runEmployeeId_idx" ON "payroll"."UkPayrollInputLine"("runEmployeeId");
CREATE INDEX "UkPayrollInputLine_employeeId_idx" ON "payroll"."UkPayrollInputLine"("employeeId");
CREATE INDEX "UkPayrollInputLine_sourceVisitReconciliationId_idx"
  ON "payroll"."UkPayrollInputLine"("sourceVisitReconciliationId");

ALTER TABLE "payroll"."UkPayrollInputLine"
  ADD CONSTRAINT "UkPayrollInputLine_runId_fkey"
  FOREIGN KEY ("runId") REFERENCES "payroll"."UkPayrollRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "payroll"."UkPayrollInputLine"
  ADD CONSTRAINT "UkPayrollInputLine_runEmployeeId_fkey"
  FOREIGN KEY ("runEmployeeId") REFERENCES "payroll"."UkPayrollRunEmployee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
