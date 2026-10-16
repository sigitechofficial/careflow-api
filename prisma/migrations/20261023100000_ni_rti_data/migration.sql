-- Gate C10: National Insurance data for future RTI (FPS) reporting.
-- Additive: nullable columns only. Nothing is backfilled: runs and contributions from before this
-- migration keep null NI figures, which mark them as needing historical reconstruction before an
-- FPS can report their year (find them with: niableEarnings IS NULL).
-- Rollback: drop the columns.

-- AlterTable
ALTER TABLE "payroll"."UkPayrollRunEmployee" ADD COLUMN     "niableEarnings" DECIMAL(12,2),
ADD COLUMN     "niEarningsAtLel" DECIMAL(12,2),
ADD COLUMN     "niEarningsLelToPt" DECIMAL(12,2),
ADD COLUMN     "niEarningsPtToUel" DECIMAL(12,2);

-- AlterTable
ALTER TABLE "payroll"."EmployeePayrollYtdContribution" ADD COLUMN     "niCategory" TEXT,
ADD COLUMN     "directorNicMethod" TEXT,
ADD COLUMN     "niableEarnings" DECIMAL(12,2),
ADD COLUMN     "niEarningsAtLel" DECIMAL(12,2),
ADD COLUMN     "niEarningsLelToPt" DECIMAL(12,2),
ADD COLUMN     "niEarningsPtToUel" DECIMAL(12,2);
