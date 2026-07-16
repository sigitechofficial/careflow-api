-- CreateEnum
CREATE TYPE "identity"."SalaryCalculationBasis" AS ENUM ('MONTHLY', 'WEEKLY');

-- AlterTable
ALTER TABLE "identity"."OrganisationGeneralSettings"
    ADD COLUMN "salaryCalculationBasis" "identity"."SalaryCalculationBasis" NOT NULL DEFAULT 'MONTHLY';
