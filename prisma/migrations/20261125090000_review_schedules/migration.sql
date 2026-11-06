-- Review schedules (docs/SUPERVISION_MODULE_PLAN.md). A review type is now repeating, a set of
-- milestones after the carer's start date, or event-only, and can apply to NMC registrants only.
-- The data fixes below only touch rows still holding the earlier seeded values, so anything an
-- admin changed is left alone.

-- CreateEnum
CREATE TYPE "lookups"."ReviewScheduleKind" AS ENUM ('REPEATING', 'MILESTONES', 'EVENT');

-- CreateEnum
CREATE TYPE "lookups"."ReviewAudience" AS ENUM ('ALL_STAFF', 'NMC_REGISTRANTS');

-- AlterTable
ALTER TABLE "lookups"."ReviewType" ADD COLUMN     "audience" "lookups"."ReviewAudience" NOT NULL DEFAULT 'ALL_STAFF',
ADD COLUMN     "firstDueAfterStartDays" INTEGER,
ADD COLUMN     "milestoneDays" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
ADD COLUMN     "scheduleKind" "lookups"."ReviewScheduleKind" NOT NULL DEFAULT 'REPEATING';

-- Recalculate trackers worked out from the old intervals (before the intervals change below).
UPDATE "employees"."EmployeeReview" r
SET "nextDue" = r."lastDone" + INTERVAL '90 days'
FROM "lookups"."ReviewType" t
WHERE r."reviewTypeId" = t."id" AND t."code" = 'CLINICAL_SUPERVISION' AND t."defaultIntervalDays" = 28
  AND r."deletedAt" IS NULL AND r."lastDone" IS NOT NULL AND r."nextDue" = r."lastDone" + INTERVAL '28 days';

UPDATE "employees"."EmployeeReview" r
SET "nextDue" = r."lastDone" + INTERVAL '1095 days'
FROM "lookups"."ReviewType" t
WHERE r."reviewTypeId" = t."id" AND t."code" = 'NMC_REVALIDATION_DISCUSSION' AND t."defaultIntervalDays" = 365
  AND r."deletedAt" IS NULL AND r."lastDone" IS NOT NULL AND r."nextDue" = r."lastDone" + INTERVAL '365 days';

-- Milestones after the start date instead of repeating for ever.
UPDATE "lookups"."ReviewType" SET "scheduleKind" = 'MILESTONES', "milestoneDays" = ARRAY[30, 90, 180], "defaultIntervalDays" = NULL,
  "description" = 'Reviews 1, 3 and 6 months after the start date (common UK probation practice)'
WHERE "code" = 'PROBATION_REVIEW' AND "defaultIntervalDays" = 30;

UPDATE "lookups"."ReviewType" SET "scheduleKind" = 'MILESTONES', "milestoneDays" = ARRAY[7, 14, 21, 28], "defaultIntervalDays" = NULL,
  "description" = 'Weekly in the first four weeks (Skills for Care: more supervision during induction)'
WHERE "code" = 'INDUCTION_CHECKIN' AND "defaultIntervalDays" = 7;

UPDATE "lookups"."ReviewType" SET "scheduleKind" = 'MILESTONES', "milestoneDays" = ARRAY[84], "defaultIntervalDays" = NULL,
  "description" = 'Once, about 12 weeks after starting (Skills for Care guided time)'
WHERE "code" = 'CARE_CERTIFICATE_SIGNOFF' AND "defaultIntervalDays" = 84;

-- Registered nurses only, at defensible intervals.
UPDATE "lookups"."ReviewType" SET "defaultIntervalDays" = 90, "audience" = 'NMC_REGISTRANTS',
  "description" = 'Staff with an NMC PIN; at least every 3 months (no NMC-set frequency)'
WHERE "code" = 'CLINICAL_SUPERVISION' AND "defaultIntervalDays" = 28;

UPDATE "lookups"."ReviewType" SET "defaultIntervalDays" = 1095, "audience" = 'NMC_REGISTRANTS',
  "description" = 'Staff with an NMC PIN; NMC revalidation every 3 years (reflective discussion)'
WHERE "code" = 'NMC_REVALIDATION_DISCUSSION' AND "defaultIntervalDays" = 365;

-- Only when something happens (a team meeting is not chased per carer).
UPDATE "lookups"."ReviewType" SET "scheduleKind" = 'EVENT'
WHERE "code" IN ('RETURN_TO_WORK', 'PERFORMANCE_IMPROVEMENT');

UPDATE "lookups"."ReviewType" SET "scheduleKind" = 'EVENT', "defaultIntervalDays" = NULL
WHERE "code" = 'TEAM_MEETING' AND "defaultIntervalDays" = 30;

-- First due soon after starting.
UPDATE "lookups"."ReviewType" SET "firstDueAfterStartDays" = 30
WHERE "code" = 'SPOT_CHECK' AND "firstDueAfterStartDays" IS NULL;

UPDATE "lookups"."ReviewType" SET "firstDueAfterStartDays" = 7
WHERE "code" IN ('PHONE_SOCIAL_MEDIA', 'WHISTLEBLOWING_AWARENESS') AND "firstDueAfterStartDays" IS NULL;

-- A repeating type with no interval never comes due: treat it as event-only.
UPDATE "lookups"."ReviewType" SET "scheduleKind" = 'EVENT'
WHERE "scheduleKind" = 'REPEATING' AND "defaultIntervalDays" IS NULL;
