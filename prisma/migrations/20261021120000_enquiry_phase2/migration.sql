-- CreateEnum
CREATE TYPE "service_users"."EnquiryFundingType" AS ENUM ('SELF_FUNDED', 'LOCAL_AUTHORITY', 'NHS_CHC', 'MIXED', 'UNKNOWN');

-- AlterTable
ALTER TABLE "service_users"."Enquiry" ADD COLUMN     "addressLine" TEXT,
ADD COLUMN     "funderName" TEXT,
ADD COLUMN     "fundingType" "service_users"."EnquiryFundingType",
ADD COLUMN     "hoursPerWeek" DOUBLE PRECISION,
ADD COLUMN     "nextAction" TEXT,
ADD COLUMN     "nextFollowUpAt" TIMESTAMP(3),
ADD COLUMN     "postcode" TEXT,
ADD COLUMN     "requestedStartDate" TIMESTAMP(3),
ADD COLUMN     "visitsPerDay" INTEGER;

