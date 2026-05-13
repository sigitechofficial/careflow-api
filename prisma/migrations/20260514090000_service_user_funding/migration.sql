-- Enums
CREATE TYPE "service_users"."FundingBillingType" AS ENUM ('SINGLE_FUNDER', 'SPLIT_SU_WEEKLY_CONTRIBUTION');
CREATE TYPE "service_users"."FundingFunderKind" AS ENUM ('SERVICE_USER', 'CONTACT', 'EXTERNAL_FUNDER');

-- ServiceUser column
ALTER TABLE "service_users"."ServiceUser" ADD COLUMN "socialServicesRef" TEXT;

-- Lookup tables
CREATE TABLE "service_users"."FundingCareService" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FundingCareService_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FundingCareService_code_key" ON "service_users"."FundingCareService"("code");

CREATE TABLE "service_users"."RateCard" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isCustom" BOOLEAN NOT NULL DEFAULT false,
    "serviceUserId" UUID,
    "standardHourlyRate" DECIMAL(12,2),
    "mileageRatePerUnit" DECIMAL(12,4),
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "linkedCareServiceId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RateCard_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RateCard_code_key" ON "service_users"."RateCard"("code");

CREATE TABLE "service_users"."ServiceUserFundingProfile" (
    "id" UUID NOT NULL,
    "serviceUserId" UUID NOT NULL,
    "careServiceId" UUID NOT NULL,
    "billingType" "service_users"."FundingBillingType" NOT NULL,
    "funder1Kind" "service_users"."FundingFunderKind" NOT NULL,
    "funder1ContactId" UUID,
    "funder1ExternalName" TEXT,
    "rateCardId" UUID NOT NULL,
    "invoiceMileage" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),
    "createdById" UUID,
    "updatedById" UUID,
    "deletedById" UUID,

    CONSTRAINT "ServiceUserFundingProfile_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ServiceUserFundingProfile_serviceUserId_idx" ON "service_users"."ServiceUserFundingProfile"("serviceUserId");
CREATE INDEX "ServiceUserFundingProfile_deletedAt_idx" ON "service_users"."ServiceUserFundingProfile"("deletedAt");

ALTER TABLE "service_users"."RateCard" ADD CONSTRAINT "RateCard_serviceUserId_fkey" FOREIGN KEY ("serviceUserId") REFERENCES "service_users"."ServiceUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "service_users"."RateCard" ADD CONSTRAINT "RateCard_linkedCareServiceId_fkey" FOREIGN KEY ("linkedCareServiceId") REFERENCES "service_users"."FundingCareService"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "service_users"."ServiceUserFundingProfile" ADD CONSTRAINT "ServiceUserFundingProfile_serviceUserId_fkey" FOREIGN KEY ("serviceUserId") REFERENCES "service_users"."ServiceUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "service_users"."ServiceUserFundingProfile" ADD CONSTRAINT "ServiceUserFundingProfile_careServiceId_fkey" FOREIGN KEY ("careServiceId") REFERENCES "service_users"."FundingCareService"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "service_users"."ServiceUserFundingProfile" ADD CONSTRAINT "ServiceUserFundingProfile_rateCardId_fkey" FOREIGN KEY ("rateCardId") REFERENCES "service_users"."RateCard"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "service_users"."ServiceUserFundingProfile" ADD CONSTRAINT "ServiceUserFundingProfile_funder1ContactId_fkey" FOREIGN KEY ("funder1ContactId") REFERENCES "service_users"."ServiceUserContact"("id") ON DELETE SET NULL ON UPDATE CASCADE;
