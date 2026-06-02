-- CreateEnum
CREATE TYPE "service_users"."MedicationSchedulePattern" AS ENUM ('DAILY', 'WEEKLY', 'MONTHLY');

-- AlterTable
ALTER TABLE "service_users"."ServiceUserMedication"
ADD COLUMN "schedulePattern" "service_users"."MedicationSchedulePattern",
ADD COLUMN "frequencyIntervalDays" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN "monthlyDayOfMonth" INTEGER,
ADD COLUMN "monthlyAnchorToStartDate" BOOLEAN NOT NULL DEFAULT true;
