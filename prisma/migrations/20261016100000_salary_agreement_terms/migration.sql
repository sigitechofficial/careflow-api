-- WM-02 / WM-03 / WM-09: salary agreements.
-- Additive only: nullable columns, no existing row is changed.
--  * EmployeePayAgreement: how the salary was entered, how a part period is paid, what the salary
--    already pays for, who approved it, and when its terms last changed.
--  * UkPayrollInputLine: the value of a source earning the line does not pay, with the reason
--    (covered by salary, or held because the coverage is not decided).
-- An existing agreement keeps its earlier behaviour for the salary amount (calendar days / 365.25).
-- Rollback: drop the nine columns. Doing so loses the record of what a salary covered on runs
-- calculated after this migration, so it is not a routine step once such runs exist.

-- AlterTable
ALTER TABLE "payroll"."EmployeePayAgreement" ADD COLUMN     "approvedAt" TIMESTAMP(3),
ADD COLUMN     "approvedById" UUID,
ADD COLUMN     "salaryCoverage" TEXT,
ADD COLUMN     "salaryEntryAmount" DECIMAL(12,2),
ADD COLUMN     "salaryEntryPeriod" TEXT,
ADD COLUMN     "salaryProrationMethod" TEXT,
ADD COLUMN     "termsChangedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "payroll"."UkPayrollInputLine" ADD COLUMN     "unpaidAmount" DECIMAL(12,2),
ADD COLUMN     "unpaidReason" TEXT;
