-- CreateEnum
CREATE TYPE "service_users"."EnquiryLostReason" AS ENUM ('PRICE', 'CHOSE_ANOTHER_PROVIDER', 'NO_CAPACITY', 'OUT_OF_AREA', 'NEEDS_NOT_MET', 'MOVED_TO_CARE_HOME', 'NO_LONGER_NEEDED', 'DECEASED', 'NO_RESPONSE', 'FUNDING_DECLINED', 'OTHER');

-- AlterTable
ALTER TABLE "service_users"."Enquiry" ADD COLUMN     "assessmentAt" TIMESTAMP(3),
ADD COLUMN     "assessmentLocation" TEXT,
ADD COLUMN     "assessorId" UUID,
ADD COLUMN     "locationId" UUID,
ADD COLUMN     "lostReasonCode" "service_users"."EnquiryLostReason",
ADD COLUMN     "quoteHourlyRate" DOUBLE PRECISION,
ADD COLUMN     "quoteNotes" TEXT,
ADD COLUMN     "quoteSentAt" TIMESTAMP(3),
ADD COLUMN     "quoteWeeklyAmount" DOUBLE PRECISION;

-- CreateIndex
CREATE INDEX "Enquiry_locationId_idx" ON "service_users"."Enquiry"("locationId");

