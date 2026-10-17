-- Gate C11: student and postgraduate loan deductions (monthly UK payroll, 2026-27).
-- Additive. Amount columns default to 0, which is what earlier runs actually deducted (no loan
-- deduction existed before C11); the plan / postgraduate flags stay null on earlier rows, which
-- marks them as calculated before loans were supported. Nothing is backfilled.
-- Rollback: drop the columns.

-- AlterTable
ALTER TABLE "payroll"."UkPayrollRunEmployee" ADD COLUMN     "studentLoanPlanApplied" TEXT,
ADD COLUMN     "studentLoanDeduction" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "postgraduateLoanApplied" BOOLEAN,
ADD COLUMN     "postgraduateLoanDeduction" DECIMAL(12,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "payroll"."EmployeePayrollYtdLedger" ADD COLUMN     "studentLoanYtd" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "postgraduateLoanYtd" DECIMAL(12,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "payroll"."EmployeePayrollYtdContribution" ADD COLUMN     "studentLoan" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "postgraduateLoan" DECIMAL(12,2) NOT NULL DEFAULT 0;
