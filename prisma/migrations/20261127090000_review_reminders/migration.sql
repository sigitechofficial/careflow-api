-- Reviews & reminders (Settings → Reviews & reminders).
--
-- 1. reviewSettings: review / expiry windows, assessment interval overrides and the reminder jobs.
--    Missing keys use the defaults in review-settings.util.ts, so '{}' keeps today's behaviour.
-- 2. reviewCarePlanAfterDays is retired: nothing read it. Care plan review dates come from each
--    Care Pathway form's review frequency (CarePathwayForm.reviewFrequencyMonths).
-- 3. ComplianceReminder: one row per record, stage and expiry date, so the expiry job can claim a
--    reminder before sending it (and a renewed record with a new expiry date gets fresh reminders).
-- 4. ReviewReminderLog: the same claim-first log for care plan and assessment review reminders
--    (replaces the 7-day audit-log look-back).

ALTER TABLE "identity"."OrganisationGeneralSettings" ADD COLUMN "reviewSettings" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "identity"."OrganisationGeneralSettings" DROP COLUMN "reviewCarePlanAfterDays";

-- Nothing wrote ComplianceReminder before this release; remove any duplicates defensively.
DELETE FROM "employees"."ComplianceReminder" a
USING "employees"."ComplianceReminder" b
WHERE a."employeeComplianceId" = b."employeeComplianceId"
  AND a."reminderType" = b."reminderType"
  AND a."dueDate" = b."dueDate"
  AND a."id" > b."id";

CREATE UNIQUE INDEX "ComplianceReminder_employeeComplianceId_reminderType_dueDat_key"
  ON "employees"."ComplianceReminder"("employeeComplianceId", "reminderType", "dueDate");

CREATE TYPE "service_users"."ReviewReminderSubject" AS ENUM ('CARE_PLAN', 'ASSESSMENT');

CREATE TABLE "service_users"."ReviewReminderLog" (
    "id" UUID NOT NULL,
    "subjectType" "service_users"."ReviewReminderSubject" NOT NULL,
    "subjectId" UUID NOT NULL,
    "serviceUserId" UUID NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "kind" TEXT NOT NULL,
    "recipientUserIds" UUID[],
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReviewReminderLog_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ReviewReminderLog_subjectType_subjectId_dueDate_kind_key"
  ON "service_users"."ReviewReminderLog"("subjectType", "subjectId", "dueDate", "kind");
CREATE INDEX "ReviewReminderLog_serviceUserId_idx" ON "service_users"."ReviewReminderLog"("serviceUserId");
