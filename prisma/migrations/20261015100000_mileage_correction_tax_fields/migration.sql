-- D-21 / R-21: a correction to settled mileage is a reimbursement, not wages. The pay item that
-- carries it records how much of the difference is within HMRC's approved amount and how much is
-- above it. Additive only: three nullable columns; no existing row is changed.

-- AlterTable
ALTER TABLE "billing"."EmployeePayItem" ADD COLUMN     "taxFreeAmount" DECIMAL(12,2),
ADD COLUMN     "taxTreatment" TEXT,
ADD COLUMN     "taxableAmount" DECIMAL(12,2);

