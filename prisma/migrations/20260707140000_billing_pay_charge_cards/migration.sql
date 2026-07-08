-- Billing module: carer pay cards and service user charge cards

CREATE SCHEMA IF NOT EXISTS "billing";

CREATE TYPE "billing"."BillingCardStatus" AS ENUM (
  'DRAFT',
  'PENDING_APPROVAL',
  'ACTIVE',
  'SCHEDULED',
  'EXPIRED',
  'ARCHIVED',
  'SUSPENDED',
  'REPLACED'
);

CREATE TYPE "billing"."PayCardAssignmentLevel" AS ENUM (
  'CARER',
  'ROLE',
  'BRANCH',
  'EMPLOYMENT_TYPE',
  'WORKER_TYPE',
  'ORGANISATION_DEFAULT'
);

CREATE TYPE "billing"."ChargeCardAssignmentLevel" AS ENUM (
  'SERVICE_USER',
  'FUNDER',
  'FUNDING_CONTRACT',
  'CARE_PACKAGE',
  'SERVICE_TYPE',
  'BRANCH_REGION',
  'GROUP_HOUSEHOLD',
  'ORGANISATION_DEFAULT'
);

CREATE TYPE "billing"."BillingRateType" AS ENUM (
  'HOURLY',
  'FIXED',
  'BANDED',
  'MILEAGE',
  'TRAVEL_TIME',
  'WAITING_TIME',
  'PER_VISIT_FEE',
  'SUBSCRIPTION',
  'UPLIFT',
  'PREMIUM',
  'DEDUCTION'
);

CREATE TYPE "billing"."BillingDayType" AS ENUM (
  'WEEKDAY',
  'SATURDAY',
  'SUNDAY',
  'BANK_HOLIDAY',
  'ANY'
);

CREATE TYPE "billing"."BillingFrequency" AS ENUM (
  'WEEKLY',
  'FOUR_WEEKLY',
  'MONTHLY',
  'CUSTOM'
);

CREATE TYPE "billing"."BillingChargeMethod" AS ENUM (
  'HOURLY_PRO_RATA',
  'FIXED_VISIT',
  'BANDED_DURATION',
  'DAILY_RATE',
  'WEEKLY_PACKAGE',
  'MONTHLY_PACKAGE',
  'SLEEP_IN',
  'WAKING_NIGHT',
  'NON_CHARGEABLE'
);

CREATE TABLE "billing"."PayCard" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "name" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "assignmentLevel" "billing"."PayCardAssignmentLevel" NOT NULL DEFAULT 'ORGANISATION_DEFAULT',
  "assignmentLabel" TEXT,
  "currency" TEXT NOT NULL DEFAULT 'GBP',
  "status" "billing"."BillingCardStatus" NOT NULL DEFAULT 'DRAFT',
  "effectiveFrom" DATE NOT NULL,
  "effectiveTo" DATE,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deletedAt" TIMESTAMP(3),
  "createdById" UUID,
  "updatedById" UUID,
  CONSTRAINT "PayCard_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PayCard_code_key" ON "billing"."PayCard"("code");
CREATE INDEX "PayCard_deletedAt_idx" ON "billing"."PayCard"("deletedAt");
CREATE INDEX "PayCard_status_idx" ON "billing"."PayCard"("status");

CREATE TABLE "billing"."PayCardRule" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "payCardId" UUID NOT NULL,
  "label" TEXT,
  "serviceType" TEXT,
  "dayType" "billing"."BillingDayType" NOT NULL DEFAULT 'ANY',
  "startTime" TEXT,
  "endTime" TEXT,
  "rateType" "billing"."BillingRateType" NOT NULL DEFAULT 'HOURLY',
  "amount" DECIMAL(12,4) NOT NULL,
  "multiplier" DECIMAL(8,4),
  "minimumMinutes" INTEGER,
  "roundingRule" TEXT,
  "priority" INTEGER NOT NULL DEFAULT 0,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "PayCardRule_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PayCardRule_payCardId_fkey" FOREIGN KEY ("payCardId") REFERENCES "billing"."PayCard"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "PayCardRule_payCardId_idx" ON "billing"."PayCardRule"("payCardId");

CREATE TABLE "billing"."ChargeCard" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "name" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "assignmentLevel" "billing"."ChargeCardAssignmentLevel" NOT NULL DEFAULT 'ORGANISATION_DEFAULT',
  "assignmentLabel" TEXT,
  "currency" TEXT NOT NULL DEFAULT 'GBP',
  "billingFrequency" "billing"."BillingFrequency" NOT NULL DEFAULT 'WEEKLY',
  "paymentTerms" TEXT,
  "taxTreatment" TEXT,
  "invoiceGroupingRule" TEXT,
  "defaultChargeMethod" "billing"."BillingChargeMethod" NOT NULL DEFAULT 'HOURLY_PRO_RATA',
  "status" "billing"."BillingCardStatus" NOT NULL DEFAULT 'DRAFT',
  "effectiveFrom" DATE NOT NULL,
  "effectiveTo" DATE,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deletedAt" TIMESTAMP(3),
  "createdById" UUID,
  "updatedById" UUID,
  CONSTRAINT "ChargeCard_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ChargeCard_code_key" ON "billing"."ChargeCard"("code");
CREATE INDEX "ChargeCard_deletedAt_idx" ON "billing"."ChargeCard"("deletedAt");
CREATE INDEX "ChargeCard_status_idx" ON "billing"."ChargeCard"("status");

CREATE TABLE "billing"."ChargeCardRule" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "chargeCardId" UUID NOT NULL,
  "label" TEXT,
  "serviceType" TEXT,
  "dayType" "billing"."BillingDayType" NOT NULL DEFAULT 'ANY',
  "startTime" TEXT,
  "endTime" TEXT,
  "chargeMethod" "billing"."BillingChargeMethod" NOT NULL DEFAULT 'HOURLY_PRO_RATA',
  "rateType" "billing"."BillingRateType" NOT NULL DEFAULT 'HOURLY',
  "amount" DECIMAL(12,4) NOT NULL,
  "multiplier" DECIMAL(8,4),
  "minimumMinutes" INTEGER,
  "roundingRule" TEXT,
  "chargeableFlag" BOOLEAN NOT NULL DEFAULT true,
  "priority" INTEGER NOT NULL DEFAULT 0,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "ChargeCardRule_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ChargeCardRule_chargeCardId_fkey" FOREIGN KEY ("chargeCardId") REFERENCES "billing"."ChargeCard"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "ChargeCardRule_chargeCardId_idx" ON "billing"."ChargeCardRule"("chargeCardId");
