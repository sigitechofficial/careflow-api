-- UK carer pay rate-card framework extensions (time bands, mileage, NMW, components)

CREATE TYPE billing."PayStackingPolicy" AS ENUM ('PRIORITY', 'HIGHEST', 'STACK');
CREATE TYPE billing."PayEnhancementMethod" AS ENUM (
  'ABSOLUTE_HOURLY',
  'ADDITIONAL_PER_HOUR',
  'PERCENTAGE_UPLIFT',
  'MULTIPLIER'
);
CREATE TYPE billing."HolidayPayMethod" AS ENUM (
  'ACCRUAL_WHEN_TAKEN',
  'ROLLED_UP_12_07',
  'REFERENCE_52_WEEK',
  'CONTRACTUAL_ABOVE_STATUTORY'
);
CREATE TYPE billing."MileageVehicleType" AS ENUM (
  'CAR_VAN',
  'MOTORCYCLE',
  'BICYCLE',
  'COMPANY_VEHICLE',
  'PUBLIC_TRANSPORT'
);

ALTER TYPE billing."BillingDayType" ADD VALUE IF NOT EXISTS 'CHRISTMAS';
ALTER TYPE billing."BillingDayType" ADD VALUE IF NOT EXISTS 'BOXING_DAY';
ALTER TYPE billing."BillingDayType" ADD VALUE IF NOT EXISTS 'NEW_YEAR';
ALTER TYPE billing."BillingDayType" ADD VALUE IF NOT EXISTS 'EASTER';
ALTER TYPE billing."BillingDayType" ADD VALUE IF NOT EXISTS 'SPECIAL';

ALTER TYPE billing."PayCardAssignmentLevel" ADD VALUE IF NOT EXISTS 'INDIVIDUAL';
ALTER TYPE billing."PayCardAssignmentLevel" ADD VALUE IF NOT EXISTS 'CLIENT_FUNDER';

ALTER TYPE billing."PayrollRunLineType" ADD VALUE IF NOT EXISTS 'WAITING_TIME';
ALTER TYPE billing."PayrollRunLineType" ADD VALUE IF NOT EXISTS 'SLEEP_IN';
ALTER TYPE billing."PayrollRunLineType" ADD VALUE IF NOT EXISTS 'WAKING_NIGHT';
ALTER TYPE billing."PayrollRunLineType" ADD VALUE IF NOT EXISTS 'ON_CALL_STANDBY';
ALTER TYPE billing."PayrollRunLineType" ADD VALUE IF NOT EXISTS 'CALL_OUT';
ALTER TYPE billing."PayrollRunLineType" ADD VALUE IF NOT EXISTS 'OVERTIME';
ALTER TYPE billing."PayrollRunLineType" ADD VALUE IF NOT EXISTS 'NON_VISIT_ACTIVITY';
ALTER TYPE billing."PayrollRunLineType" ADD VALUE IF NOT EXISTS 'CANCELLATION';
ALTER TYPE billing."PayrollRunLineType" ADD VALUE IF NOT EXISTS 'DOUBLE_UP_SUPPLEMENT';
ALTER TYPE billing."PayrollRunLineType" ADD VALUE IF NOT EXISTS 'HOLIDAY_PAY';
ALTER TYPE billing."PayrollRunLineType" ADD VALUE IF NOT EXISTS 'ALLOWANCE';
ALTER TYPE billing."PayrollRunLineType" ADD VALUE IF NOT EXISTS 'EXPENSE';
ALTER TYPE billing."PayrollRunLineType" ADD VALUE IF NOT EXISTS 'PASSENGER_MILEAGE';
ALTER TYPE billing."PayrollRunLineType" ADD VALUE IF NOT EXISTS 'EMPLOYER_COST_NOTE';

-- PayCard: drop unique(code) if present, add versioned uniqueness
ALTER TABLE billing."PayCard" ADD COLUMN IF NOT EXISTS "nation" TEXT DEFAULT 'ENG';
ALTER TABLE billing."PayCard" ADD COLUMN IF NOT EXISTS "payFrequency" billing."BillingFrequency" NOT NULL DEFAULT 'WEEKLY';
ALTER TABLE billing."PayCard" ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE billing."PayCard" ADD COLUMN IF NOT EXISTS "stackingPolicy" billing."PayStackingPolicy" NOT NULL DEFAULT 'PRIORITY';
ALTER TABLE billing."PayCard" ADD COLUMN IF NOT EXISTS "holidayPayMethod" billing."HolidayPayMethod";
ALTER TABLE billing."PayCard" ADD COLUMN IF NOT EXISTS "travelInheritsTimeBands" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE billing."PayCard" ADD COLUMN IF NOT EXISTS "mileageVehicleType" billing."MileageVehicleType" NOT NULL DEFAULT 'CAR_VAN';
ALTER TABLE billing."PayCard" ADD COLUMN IF NOT EXISTS "useUkMileageRates" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE billing."PayCard" ADD COLUMN IF NOT EXISTS "replacedById" UUID;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'PayCard_code_key' AND conrelid = 'billing."PayCard"'::regclass
  ) THEN
    ALTER TABLE billing."PayCard" DROP CONSTRAINT "PayCard_code_key";
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "PayCard_code_version_key" ON billing."PayCard" ("code", "version");

ALTER TABLE billing."PayCardRule" ADD COLUMN IF NOT EXISTS "additionalAmount" DECIMAL(12,4);
ALTER TABLE billing."PayCardRule" ADD COLUMN IF NOT EXISTS "percentageUplift" DECIMAL(8,4);
ALTER TABLE billing."PayCardRule" ADD COLUMN IF NOT EXISTS "enhancementMethod" billing."PayEnhancementMethod";
ALTER TABLE billing."PayCardRule" ADD COLUMN IF NOT EXISTS "appliesToVisit" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE billing."PayCardRule" ADD COLUMN IF NOT EXISTS "appliesToTravel" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE billing."PayCardRule" ADD COLUMN IF NOT EXISTS "appliesToWaiting" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE billing."PayCardRule" ADD COLUMN IF NOT EXISTS "appliesToTraining" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE billing."PayrollRun" ADD COLUMN IF NOT EXISTS "expenseTotal" DECIMAL(12,2) NOT NULL DEFAULT 0;
ALTER TABLE billing."PayrollRun" ADD COLUMN IF NOT EXISTS "estimatedEmployerNi" DECIMAL(12,2) NOT NULL DEFAULT 0;
ALTER TABLE billing."PayrollRun" ADD COLUMN IF NOT EXISTS "estimatedEmployerPension" DECIMAL(12,2) NOT NULL DEFAULT 0;
ALTER TABLE billing."PayrollRun" ADD COLUMN IF NOT EXISTS "estimatedEmployerCost" DECIMAL(12,2) NOT NULL DEFAULT 0;

ALTER TABLE employees."EmployeeEmployment" ADD COLUMN IF NOT EXISTS "holidayPayMethod" TEXT;
ALTER TABLE employees."EmployeeEmployment" ADD COLUMN IF NOT EXISTS "guaranteedWeeklyHours" DOUBLE PRECISION;
ALTER TABLE employees."EmployeeEmployment" ADD COLUMN IF NOT EXISTS "individualBaseRate" DOUBLE PRECISION;

CREATE TABLE IF NOT EXISTS billing."PayComponent" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "workerId" UUID NOT NULL,
  "shiftOrVisitId" UUID,
  "payrollRunId" UUID,
  "visitReconciliationId" UUID,
  "componentType" TEXT NOT NULL,
  "sourceDurationMinutes" INTEGER,
  "approvedDurationMinutes" INTEGER,
  "appliedRate" DECIMAL(12,4),
  "multiplier" DECIMAL(8,4),
  "amount" DECIMAL(12,2) NOT NULL,
  "taxable" BOOLEAN NOT NULL DEFAULT true,
  "pensionable" BOOLEAN NOT NULL DEFAULT true,
  "nmwInclusion" BOOLEAN NOT NULL DEFAULT true,
  "approvalStatus" TEXT NOT NULL DEFAULT 'AUTO',
  "calculationExplanation" TEXT NOT NULL,
  "rateCardId" UUID,
  "rateCardVersion" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "PayComponent_workerId_idx" ON billing."PayComponent" ("workerId");
CREATE INDEX IF NOT EXISTS "PayComponent_payrollRunId_idx" ON billing."PayComponent" ("payrollRunId");
CREATE INDEX IF NOT EXISTS "PayComponent_visitReconciliationId_idx" ON billing."PayComponent" ("visitReconciliationId");
CREATE INDEX IF NOT EXISTS "PayComponent_componentType_idx" ON billing."PayComponent" ("componentType");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'PayComponent_rateCardId_fkey'
  ) THEN
    ALTER TABLE billing."PayComponent"
      ADD CONSTRAINT "PayComponent_rateCardId_fkey"
      FOREIGN KEY ("rateCardId") REFERENCES billing."PayCard"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
