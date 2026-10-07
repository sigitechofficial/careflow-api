-- Status flow v2: Reported → Under Review → Under Investigation → Actions Required → Awaiting Closure → Closed.
-- "Awaiting Review" becomes "Under Review" (set when a manager starts the review).
ALTER TYPE "incidents"."IncidentStatus" RENAME VALUE 'AWAITING_REVIEW' TO 'UNDER_REVIEW';

-- Reopening is now an event, not a status: track it on the incident.
ALTER TABLE "incidents"."Incident"
  ADD COLUMN "reviewStartedAt" TIMESTAMP(3),
  ADD COLUMN "reopenCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "lastReopenedAt" TIMESTAMP(3);

-- Existing REOPENED rows go back to Under Review (the enum value stays for history rows).
UPDATE "incidents"."Incident"
SET "status" = 'UNDER_REVIEW',
    "reopenCount" = "reopenCount" + 1,
    "lastReopenedAt" = COALESCE("lastReopenedAt", "updatedAt")
WHERE "status" = 'REOPENED';
