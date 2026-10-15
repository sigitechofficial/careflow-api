-- Real organisation + CQC-registered branch fields (Allfor Care Services Limited).
-- Organisation = identity.CompanyProfile (singleton); branch = scheduling.ScheduleArea (+ lookups.Location).
-- Additive only: every new column is nullable or has a default, so existing rows are unaffected.

-- CreateEnum
CREATE TYPE "scheduling"."BranchStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'CLOSED');

-- CreateEnum
CREATE TYPE "scheduling"."CqcRating" AS ENUM ('OUTSTANDING', 'GOOD', 'REQUIRES_IMPROVEMENT', 'INADEQUATE');

-- CreateEnum
CREATE TYPE "scheduling"."CqcRatingStatus" AS ENUM ('RATED', 'NOT_YET_RATED');

-- AlterTable
ALTER TABLE "identity"."CompanyProfile" ADD COLUMN     "companyStatus" TEXT,
ADD COLUMN     "companyType" TEXT,
ADD COLUMN     "countryCode" TEXT NOT NULL DEFAULT 'GB',
ADD COLUMN     "cqcProviderId" TEXT,
ADD COLUMN     "currency" TEXT NOT NULL DEFAULT 'GBP',
ADD COLUMN     "incorporationDate" DATE,
ADD COLUMN     "legalName" TEXT,
ADD COLUMN     "locale" TEXT NOT NULL DEFAULT 'en-GB',
ADD COLUMN     "registeredAddressLine1" TEXT,
ADD COLUMN     "registeredAddressLine2" TEXT,
ADD COLUMN     "registeredCountry" TEXT,
ADD COLUMN     "registeredCounty" TEXT,
ADD COLUMN     "registeredPostcode" TEXT,
ADD COLUMN     "registeredTown" TEXT,
ADD COLUMN     "sicCodes" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "scheduling"."ScheduleArea" ADD COLUMN     "addressLine1" TEXT,
ADD COLUMN     "addressLine2" TEXT,
ADD COLUMN     "country" TEXT,
ADD COLUMN     "countryCode" TEXT NOT NULL DEFAULT 'GB',
ADD COLUMN     "county" TEXT,
ADD COLUMN     "cqcLocationId" TEXT,
ADD COLUMN     "cqcRating" "scheduling"."CqcRating",
ADD COLUMN     "cqcRatingStatus" "scheduling"."CqcRatingStatus",
ADD COLUMN     "cqcRegistrationDate" DATE,
ADD COLUMN     "currency" TEXT NOT NULL DEFAULT 'GBP',
ADD COLUMN     "email" TEXT,
ADD COLUMN     "latitude" DECIMAL(10,7),
ADD COLUMN     "localAuthority" TEXT,
ADD COLUMN     "locale" TEXT NOT NULL DEFAULT 'en-GB',
ADD COLUMN     "longitude" DECIMAL(10,7),
ADD COLUMN     "nominatedIndividual" TEXT,
ADD COLUMN     "officialCqcName" TEXT,
ADD COLUMN     "phone" TEXT,
ADD COLUMN     "postcode" TEXT,
ADD COLUMN     "registeredManagers" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "regulatedActivities" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "serviceTypes" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "status" "scheduling"."BranchStatus" NOT NULL DEFAULT 'ACTIVE',
ADD COLUMN     "timezone" TEXT NOT NULL DEFAULT 'Europe/London',
ADD COLUMN     "town" TEXT,
ADD COLUMN     "website" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "ScheduleArea_cqcLocationId_key" ON "scheduling"."ScheduleArea"("cqcLocationId");
