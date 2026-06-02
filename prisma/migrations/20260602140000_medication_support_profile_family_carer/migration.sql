-- AlterTable
ALTER TABLE "service_users"."MedicationSupportProfile"
ADD COLUMN "familyMemberOrCarerSupportsMedication" BOOLEAN NOT NULL DEFAULT false;
