-- Sprint B4B: annual basic hours for the minimum wage on salaried hours work.
-- Additive: six nullable columns and one new, empty table. No existing row is changed.
--  * SalariedHoursAnnualisation: the employer's approved method for turning contracted weekly
--    hours into basic hours for a year. None is created here, so until a person enters one and a
--    second person approves it, annual hours are not assessed (POLICY_REVIEW_REQUIRED).
--  * NmwPeriodAssessment: the calculation year, the annual basic hours and the multiplier used,
--    the hours worked in the year before the period, and the excess hours the assessment counted
--    (so that a later run neither counts them again nor misses them).
-- Rollback: drop the columns and the table.

-- AlterTable
ALTER TABLE "billing"."NmwPeriodAssessment" ADD COLUMN     "annualBasicMinutes" INTEGER,
ADD COLUMN     "calcYearEnd" DATE,
ADD COLUMN     "calcYearStart" DATE,
ADD COLUMN     "excessMinutes" INTEGER,
ADD COLUMN     "weeksPerYear" DECIMAL(6,3),
ADD COLUMN     "yearMinutesBefore" INTEGER;

-- CreateTable
CREATE TABLE "payroll"."SalariedHoursAnnualisation" (
    "id" UUID NOT NULL,
    "weeksPerYear" DECIMAL(6,3) NOT NULL,
    "basis" TEXT NOT NULL,
    "effectiveFrom" DATE NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "isSynthetic" BOOLEAN NOT NULL DEFAULT false,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedById" UUID,
    "approvedAt" TIMESTAMP(3),
    "withdrawnById" UUID,
    "withdrawnAt" TIMESTAMP(3),
    "withdrawnNote" TEXT,

    CONSTRAINT "SalariedHoursAnnualisation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SalariedHoursAnnualisation_status_effectiveFrom_idx" ON "payroll"."SalariedHoursAnnualisation"("status", "effectiveFrom");

