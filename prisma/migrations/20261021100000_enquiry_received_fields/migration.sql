-- CreateEnum
CREATE TYPE "service_users"."EnquiryReceivedVia" AS ENUM ('PHONE', 'EMAIL', 'WEBSITE', 'IN_PERSON', 'LETTER', 'FAX', 'OTHER');

-- AlterTable
ALTER TABLE "service_users"."Enquiry" ADD COLUMN     "receivedAt" TIMESTAMP(3),
ADD COLUMN     "receivedVia" "service_users"."EnquiryReceivedVia",
ADD COLUMN     "sentAt" TIMESTAMP(3);

