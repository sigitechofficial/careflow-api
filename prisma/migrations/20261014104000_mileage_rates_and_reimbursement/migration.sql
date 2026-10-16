-- TR-09 / TR-13: mileage rates are recorded per period instead of being fixed in the code, miles
-- and tax treatment are kept on mileage lines, and reimbursements are carried through to the
-- employee's payment.
--
-- Additive only. No existing row is changed: lines of locked pay runs are history and are not
-- touched (their miles are read from the description they were written with). The rates the
-- application was already using are inserted by the next migration.

-- AlterTable
ALTER TABLE "billing"."PayrollRunLine" ADD COLUMN     "quantity" DECIMAL(10,2),
ADD COLUMN     "taxFreeAmount" DECIMAL(12,2),
ADD COLUMN     "taxTreatment" TEXT,
ADD COLUMN     "taxableAmount" DECIMAL(12,2);

-- AlterTable
ALTER TABLE "billing"."EmployeePayoutLine" ADD COLUMN     "reimbursementAmount" DECIMAL(12,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "payroll"."UkPayrollRunEmployee" ADD COLUMN     "expenseNotVerified" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "reimbursementPayable" DECIMAL(12,2) NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "billing"."MileageRate" (
    "id" UUID NOT NULL,
    "effectiveFrom" DATE NOT NULL,
    "vehicleType" "billing"."MileageVehicleType" NOT NULL,
    "rateFirst" DECIMAL(8,4) NOT NULL,
    "rateAfter" DECIMAL(8,4) NOT NULL,
    "thresholdMiles" INTEGER,
    "passengerRate" DECIMAL(8,4) NOT NULL DEFAULT 0,
    "approvedRateFirst" DECIMAL(8,4),
    "approvedRateAfter" DECIMAL(8,4),
    "approvedThresholdMiles" INTEGER,
    "approvedPassengerRate" DECIMAL(8,4),
    "approvedSource" TEXT,
    "approvedVerifiedAt" TIMESTAMP(3),
    "approvedVerifiedById" UUID,
    "label" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" UUID,

    CONSTRAINT "MileageRate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MileageRate_effectiveFrom_vehicleType_key" ON "billing"."MileageRate"("effectiveFrom", "vehicleType");
