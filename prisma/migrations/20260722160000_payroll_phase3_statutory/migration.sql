-- Phase 3: tax-year statutory rate sets + PAYE/NI result columns.

ALTER TYPE "payroll"."UkPayrollRunStatus" ADD VALUE 'STATUTORY_CALCULATED';

CREATE TABLE "payroll"."PayrollStatutoryRateSet" (
  "id" UUID NOT NULL,
  "taxYearId" UUID NOT NULL,
  "nation" TEXT NOT NULL DEFAULT 'ENG',
  "version" INTEGER NOT NULL DEFAULT 1,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "personalAllowanceAnnual" DECIMAL(12,2) NOT NULL,
  "basicRateBandAnnual" DECIMAL(12,2) NOT NULL,
  "higherRateThresholdAnnual" DECIMAL(12,2) NOT NULL,
  "additionalRateThresholdAnnual" DECIMAL(12,2) NOT NULL,
  "basicRatePercent" DECIMAL(5,2) NOT NULL,
  "higherRatePercent" DECIMAL(5,2) NOT NULL,
  "additionalRatePercent" DECIMAL(5,2) NOT NULL,
  "niLelWeekly" DECIMAL(12,2) NOT NULL,
  "niPtWeekly" DECIMAL(12,2) NOT NULL,
  "niStWeekly" DECIMAL(12,2) NOT NULL,
  "niUelWeekly" DECIMAL(12,2) NOT NULL,
  "niLelMonthly" DECIMAL(12,2) NOT NULL,
  "niPtMonthly" DECIMAL(12,2) NOT NULL,
  "niStMonthly" DECIMAL(12,2) NOT NULL,
  "niUelMonthly" DECIMAL(12,2) NOT NULL,
  "niEmployeeRateMainPercent" DECIMAL(5,2) NOT NULL,
  "niEmployeeRateUpperPercent" DECIMAL(5,2) NOT NULL,
  "niEmployerRatePercent" DECIMAL(5,2) NOT NULL,
  "sourceNote" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PayrollStatutoryRateSet_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PayrollStatutoryRateSet_taxYearId_nation_version_key"
  ON "payroll"."PayrollStatutoryRateSet"("taxYearId", "nation", "version");
CREATE INDEX "PayrollStatutoryRateSet_taxYearId_isActive_idx"
  ON "payroll"."PayrollStatutoryRateSet"("taxYearId", "isActive");

ALTER TABLE "payroll"."PayrollStatutoryRateSet"
  ADD CONSTRAINT "PayrollStatutoryRateSet_taxYearId_fkey"
  FOREIGN KEY ("taxYearId") REFERENCES "payroll"."PayrollTaxYear"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "payroll"."UkPayrollRun"
  ADD COLUMN "totalIncomeTax" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN "totalEmployeeNi" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN "totalEmployerNi" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN "totalNetPay" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN "statutoryCalculatedAt" TIMESTAMP(3),
  ADD COLUMN "statutoryBasis" TEXT;

ALTER TABLE "payroll"."UkPayrollRunEmployee"
  ADD COLUMN "taxablePay" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN "incomeTax" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN "employeeNi" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN "employerNi" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN "netPay" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN "taxCodeApplied" TEXT,
  ADD COLUMN "niCategoryApplied" TEXT,
  ADD COLUMN "statutoryExplanation" TEXT,
  ADD COLUMN "statutoryCalculatedAt" TIMESTAMP(3);
