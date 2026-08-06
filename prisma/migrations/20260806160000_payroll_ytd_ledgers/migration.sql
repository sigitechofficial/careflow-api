-- T06: Per-employee tax-year YTD ledgers + idempotent run contributions.
CREATE TABLE "payroll"."EmployeePayrollYtdLedger" (
    "id" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "taxYearId" UUID NOT NULL,
    "grossPayYtd" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "taxablePayYtd" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "incomeTaxYtd" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "employeeNiYtd" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "employerNiYtd" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "netPayYtd" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "lastClosedRunId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" UUID,
    "updatedById" UUID,

    CONSTRAINT "EmployeePayrollYtdLedger_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "payroll"."EmployeePayrollYtdContribution" (
    "id" UUID NOT NULL,
    "ledgerId" UUID NOT NULL,
    "ukPayrollRunId" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "taxYearId" UUID NOT NULL,
    "grossPay" DECIMAL(12,2) NOT NULL,
    "taxablePay" DECIMAL(12,2) NOT NULL,
    "incomeTax" DECIMAL(12,2) NOT NULL,
    "employeeNi" DECIMAL(12,2) NOT NULL,
    "employerNi" DECIMAL(12,2) NOT NULL,
    "netPay" DECIMAL(12,2) NOT NULL,
    "isReversed" BOOLEAN NOT NULL DEFAULT false,
    "postedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reversedAt" TIMESTAMP(3),
    "createdById" UUID,
    "reversedById" UUID,

    CONSTRAINT "EmployeePayrollYtdContribution_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EmployeePayrollYtdLedger_employeeId_taxYearId_key" ON "payroll"."EmployeePayrollYtdLedger"("employeeId", "taxYearId");
CREATE INDEX "EmployeePayrollYtdLedger_taxYearId_idx" ON "payroll"."EmployeePayrollYtdLedger"("taxYearId");
CREATE INDEX "EmployeePayrollYtdLedger_employeeId_idx" ON "payroll"."EmployeePayrollYtdLedger"("employeeId");

CREATE UNIQUE INDEX "EmployeePayrollYtdContribution_ukPayrollRunId_employeeId_key" ON "payroll"."EmployeePayrollYtdContribution"("ukPayrollRunId", "employeeId");
CREATE INDEX "EmployeePayrollYtdContribution_ledgerId_idx" ON "payroll"."EmployeePayrollYtdContribution"("ledgerId");
CREATE INDEX "EmployeePayrollYtdContribution_taxYearId_idx" ON "payroll"."EmployeePayrollYtdContribution"("taxYearId");
CREATE INDEX "EmployeePayrollYtdContribution_employeeId_idx" ON "payroll"."EmployeePayrollYtdContribution"("employeeId");

ALTER TABLE "payroll"."EmployeePayrollYtdLedger" ADD CONSTRAINT "EmployeePayrollYtdLedger_taxYearId_fkey" FOREIGN KEY ("taxYearId") REFERENCES "payroll"."PayrollTaxYear"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payroll"."EmployeePayrollYtdContribution" ADD CONSTRAINT "EmployeePayrollYtdContribution_ledgerId_fkey" FOREIGN KEY ("ledgerId") REFERENCES "payroll"."EmployeePayrollYtdLedger"("id") ON DELETE CASCADE ON UPDATE CASCADE;
