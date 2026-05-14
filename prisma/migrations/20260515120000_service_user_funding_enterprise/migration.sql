-- Replace legacy care-package funding (profiles / rate cards) with enterprise funding model.

-- Drop legacy FKs and tables (order: dependents first)
ALTER TABLE "service_users"."ServiceUserFundingProfile" DROP CONSTRAINT IF EXISTS "ServiceUserFundingProfile_funder1ContactId_fkey";
ALTER TABLE "service_users"."ServiceUserFundingProfile" DROP CONSTRAINT IF EXISTS "ServiceUserFundingProfile_rateCardId_fkey";
ALTER TABLE "service_users"."ServiceUserFundingProfile" DROP CONSTRAINT IF EXISTS "ServiceUserFundingProfile_careServiceId_fkey";
ALTER TABLE "service_users"."ServiceUserFundingProfile" DROP CONSTRAINT IF EXISTS "ServiceUserFundingProfile_serviceUserId_fkey";
DROP TABLE IF EXISTS "service_users"."ServiceUserFundingProfile";

ALTER TABLE "service_users"."RateCard" DROP CONSTRAINT IF EXISTS "RateCard_linkedCareServiceId_fkey";
ALTER TABLE "service_users"."RateCard" DROP CONSTRAINT IF EXISTS "RateCard_serviceUserId_fkey";
DROP TABLE IF EXISTS "service_users"."RateCard";

DROP TABLE IF EXISTS "service_users"."FundingCareService";

DROP TYPE IF EXISTS "service_users"."FundingBillingType";
DROP TYPE IF EXISTS "service_users"."FundingFunderKind";

-- New enums and tables
CREATE TYPE "service_users"."FundingStatus" AS ENUM (
  'PENDING',
  'APPROVED',
  'ACTIVE',
  'SUSPENDED',
  'ENDED',
  'REJECTED',
  'UNKNOWN'
);

CREATE TABLE "service_users"."FundingType" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),
    "createdById" UUID,
    "updatedById" UUID,
    "deletedById" UUID,
    CONSTRAINT "FundingType_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "FundingType_code_key" ON "service_users"."FundingType"("code");

CREATE TABLE "service_users"."Funder" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "fundingTypeId" UUID,
    "contactName" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "addressLine1" TEXT,
    "addressLine2" TEXT,
    "town" TEXT,
    "county" TEXT,
    "country" TEXT,
    "postcode" TEXT,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),
    "createdById" UUID,
    "updatedById" UUID,
    "deletedById" UUID,
    CONSTRAINT "Funder_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Funder_code_key" ON "service_users"."Funder"("code");
CREATE INDEX "Funder_fundingTypeId_idx" ON "service_users"."Funder"("fundingTypeId");
CREATE INDEX "Funder_deletedAt_idx" ON "service_users"."Funder"("deletedAt");

ALTER TABLE "service_users"."Funder" ADD CONSTRAINT "Funder_fundingTypeId_fkey" FOREIGN KEY ("fundingTypeId") REFERENCES "service_users"."FundingType"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "service_users"."ServiceUser" ADD COLUMN IF NOT EXISTS "currentFundingId" UUID;

CREATE TABLE "service_users"."ServiceUserFunding" (
    "id" UUID NOT NULL,
    "serviceUserId" UUID NOT NULL,
    "fundingTypeId" UUID NOT NULL,
    "funderId" UUID,
    "status" "service_users"."FundingStatus" NOT NULL DEFAULT 'UNKNOWN',
    "fundingReference" TEXT,
    "approvalReference" TEXT,
    "packageName" TEXT,
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "weeklyBudget" DECIMAL(12,2),
    "hourlyRate" DECIMAL(12,2),
    "contributionAmount" DECIMAL(12,2),
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "approvedAt" TIMESTAMP(3),
    "approvedById" UUID,
    "reviewDate" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),
    "createdById" UUID,
    "updatedById" UUID,
    "deletedById" UUID,
    CONSTRAINT "ServiceUserFunding_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ServiceUserFunding_serviceUserId_idx" ON "service_users"."ServiceUserFunding"("serviceUserId");
CREATE INDEX "ServiceUserFunding_deletedAt_idx" ON "service_users"."ServiceUserFunding"("deletedAt");
CREATE INDEX "ServiceUserFunding_fundingTypeId_idx" ON "service_users"."ServiceUserFunding"("fundingTypeId");
CREATE INDEX "ServiceUserFunding_funderId_idx" ON "service_users"."ServiceUserFunding"("funderId");
CREATE INDEX "ServiceUserFunding_status_idx" ON "service_users"."ServiceUserFunding"("status");

ALTER TABLE "service_users"."ServiceUserFunding" ADD CONSTRAINT "ServiceUserFunding_serviceUserId_fkey" FOREIGN KEY ("serviceUserId") REFERENCES "service_users"."ServiceUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "service_users"."ServiceUserFunding" ADD CONSTRAINT "ServiceUserFunding_fundingTypeId_fkey" FOREIGN KEY ("fundingTypeId") REFERENCES "service_users"."FundingType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "service_users"."ServiceUserFunding" ADD CONSTRAINT "ServiceUserFunding_funderId_fkey" FOREIGN KEY ("funderId") REFERENCES "service_users"."Funder"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "service_users"."ServiceUserFunding" ADD CONSTRAINT "ServiceUserFunding_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "identity"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "service_users"."ServiceUser" ADD CONSTRAINT "ServiceUser_currentFundingId_fkey" FOREIGN KEY ("currentFundingId") REFERENCES "service_users"."ServiceUserFunding"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE UNIQUE INDEX "ServiceUser_currentFundingId_key" ON "service_users"."ServiceUser"("currentFundingId");
