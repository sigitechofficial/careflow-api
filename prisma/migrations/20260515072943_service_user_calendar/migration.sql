-- CreateEnum
CREATE TYPE "service_users"."ServiceUserCalendarEventStatus" AS ENUM ('SCHEDULED', 'COMPLETED', 'CANCELLED', 'MISSED', 'RESCHEDULED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "notifications"."NotificationType" ADD VALUE 'APPOINTMENT_REMINDER';
ALTER TYPE "notifications"."NotificationType" ADD VALUE 'GP_APPOINTMENT_REMINDER';
ALTER TYPE "notifications"."NotificationType" ADD VALUE 'HOSPITAL_APPOINTMENT_REMINDER';
ALTER TYPE "notifications"."NotificationType" ADD VALUE 'CARE_REVIEW_REMINDER';
ALTER TYPE "notifications"."NotificationType" ADD VALUE 'MEDICATION_REVIEW_REMINDER';
ALTER TYPE "notifications"."NotificationType" ADD VALUE 'ASSESSMENT_DUE_REMINDER';
ALTER TYPE "notifications"."NotificationType" ADD VALUE 'BIRTHDAY_REMINDER';

-- DropIndex
DROP INDEX "service_users"."ServiceUserFunding_funderId_idx";

-- DropIndex
DROP INDEX "service_users"."ServiceUserFunding_fundingTypeId_idx";

-- AlterTable
ALTER TABLE "notifications"."Notification" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "notifications"."NotificationPreference" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "notifications"."NotificationRecipient" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "service_users"."Funder" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "service_users"."FundingType" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "service_users"."ServiceUserFunding" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "service_users"."ServiceUserInitialAssessment" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- CreateTable
CREATE TABLE "service_users"."CalendarEventType" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT,
    "color" TEXT,
    "icon" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "CalendarEventType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_users"."ServiceUserCalendarEvent" (
    "id" UUID NOT NULL,
    "serviceUserId" UUID NOT NULL,
    "eventTypeId" UUID,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "startDateTime" TIMESTAMP(3) NOT NULL,
    "endDateTime" TIMESTAMP(3),
    "allDay" BOOLEAN NOT NULL DEFAULT false,
    "location" TEXT,
    "status" "service_users"."ServiceUserCalendarEventStatus" NOT NULL DEFAULT 'SCHEDULED',
    "isRecurring" BOOLEAN NOT NULL DEFAULT false,
    "recurrenceRule" TEXT,
    "reminderBeforeMinutes" INTEGER,
    "notifyKeyWorker" BOOLEAN NOT NULL DEFAULT false,
    "notifyNamedNurse" BOOLEAN NOT NULL DEFAULT false,
    "notifyManager" BOOLEAN NOT NULL DEFAULT false,
    "metadata" JSONB,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdById" UUID,
    "updatedById" UUID,
    "deletedById" UUID,

    CONSTRAINT "ServiceUserCalendarEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CalendarEventType_code_key" ON "service_users"."CalendarEventType"("code");

-- CreateIndex
CREATE INDEX "CalendarEventType_isActive_idx" ON "service_users"."CalendarEventType"("isActive");

-- CreateIndex
CREATE INDEX "CalendarEventType_deletedAt_idx" ON "service_users"."CalendarEventType"("deletedAt");

-- CreateIndex
CREATE INDEX "ServiceUserCalendarEvent_serviceUserId_idx" ON "service_users"."ServiceUserCalendarEvent"("serviceUserId");

-- CreateIndex
CREATE INDEX "ServiceUserCalendarEvent_eventTypeId_idx" ON "service_users"."ServiceUserCalendarEvent"("eventTypeId");

-- CreateIndex
CREATE INDEX "ServiceUserCalendarEvent_startDateTime_idx" ON "service_users"."ServiceUserCalendarEvent"("startDateTime");

-- CreateIndex
CREATE INDEX "ServiceUserCalendarEvent_status_idx" ON "service_users"."ServiceUserCalendarEvent"("status");

-- CreateIndex
CREATE INDEX "ServiceUserCalendarEvent_deletedAt_idx" ON "service_users"."ServiceUserCalendarEvent"("deletedAt");

-- CreateIndex
CREATE INDEX "NotificationPreference_type_idx" ON "notifications"."NotificationPreference"("type");

-- CreateIndex
CREATE INDEX "FundingType_deletedAt_idx" ON "service_users"."FundingType"("deletedAt");

-- CreateIndex
CREATE INDEX "LiveInLevelOfCare_deletedAt_idx" ON "service_users"."LiveInLevelOfCare"("deletedAt");

-- CreateIndex
CREATE INDEX "LiveInScanType_deletedAt_idx" ON "service_users"."LiveInScanType"("deletedAt");

-- CreateIndex
CREATE INDEX "LiveInServiceType_deletedAt_idx" ON "service_users"."LiveInServiceType"("deletedAt");

-- AddForeignKey
ALTER TABLE "service_users"."ServiceUserCalendarEvent" ADD CONSTRAINT "ServiceUserCalendarEvent_serviceUserId_fkey" FOREIGN KEY ("serviceUserId") REFERENCES "service_users"."ServiceUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_users"."ServiceUserCalendarEvent" ADD CONSTRAINT "ServiceUserCalendarEvent_eventTypeId_fkey" FOREIGN KEY ("eventTypeId") REFERENCES "service_users"."CalendarEventType"("id") ON DELETE SET NULL ON UPDATE CASCADE;
