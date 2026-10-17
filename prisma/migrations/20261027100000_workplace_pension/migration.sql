-- Gate C16: workplace pension contributions (defined contribution, qualifying earnings, relief at
-- source, monthly 2026-27). Additive, nullable or default-0 columns. No employee is enrolled and no
-- pension status is set: profiles stay not recorded until a person records them. Earlier runs keep
-- pensionApplied null and 0 amounts, which is what they deducted. Rollback: drop the columns.

-- AlterTable
ALTER TABLE "payroll"."EmployeePayrollYtdLedger" ADD COLUMN     "pensionEmployeeGrossYtd" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "pensionEmployeeNetYtd" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "pensionEmployerYtd" DECIMAL(12,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "payroll"."EmployeePayrollYtdContribution" ADD COLUMN     "pensionEmployeeGross" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "pensionEmployeeNet" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "pensionEmployer" DECIMAL(12,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "payroll"."EmployeePayrollProfile" ADD COLUMN     "pensionContributionBasis" TEXT,
ADD COLUMN     "pensionEmployeeRatePercent" DECIMAL(5,2),
ADD COLUMN     "pensionEmployerRatePercent" DECIMAL(5,2),
ADD COLUMN     "pensionEnrolledFrom" DATE,
ADD COLUMN     "pensionPolicyRef" TEXT,
ADD COLUMN     "pensionStatus" TEXT,
ADD COLUMN     "pensionTaxRelief" TEXT;

-- AlterTable
ALTER TABLE "payroll"."UkPayrollRunEmployee" ADD COLUMN     "pensionApplied" BOOLEAN,
ADD COLUMN     "pensionEmployeeGross" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "pensionEmployeeNet" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "pensionEmployer" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "pensionQualifyingEarnings" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "pensionTaxRelief" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "pensionablePay" DECIMAL(12,2) NOT NULL DEFAULT 0;

