-- T19: EPS submissions are tax-month based (no payroll run).
ALTER TABLE "payroll"."PayrollHmrcSubmission"
  ALTER COLUMN "ukPayrollRunId" DROP NOT NULL;

ALTER TABLE "payroll"."PayrollHmrcSubmission"
  ADD COLUMN IF NOT EXISTS "taxYearId" UUID,
  ADD COLUMN IF NOT EXISTS "taxMonth" INTEGER;

CREATE INDEX IF NOT EXISTS "PayrollHmrcSubmission_taxYearId_taxMonth_idx"
  ON "payroll"."PayrollHmrcSubmission"("taxYearId", "taxMonth");

CREATE INDEX IF NOT EXISTS "PayrollHmrcSubmission_documentType_idx"
  ON "payroll"."PayrollHmrcSubmission"("documentType");
