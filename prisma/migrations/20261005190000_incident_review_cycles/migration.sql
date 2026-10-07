-- Review: immediate / ongoing risk question, the decision stored on the review, and review cycles
-- (a reopened incident archives its review and starts a new one; archived cycles never change).
ALTER TABLE "incidents"."IncidentReview"
  ADD COLUMN "immediateRisk" BOOLEAN,
  ADD COLUMN "protectiveAction" TEXT,
  ADD COLUMN "decision" VARCHAR(30),
  ADD COLUMN "decisionReason" TEXT,
  ADD COLUMN "decidedAt" TIMESTAMP(3),
  ADD COLUMN "cycleNumber" INTEGER NOT NULL DEFAULT 1;

-- Backfill the decision for reviews whose incident already left "Under Review" through a review
-- decision (status history reasons written by the review save).
UPDATE "incidents"."IncidentReview" r
SET "decision" = CASE WHEN h."toStatus" = 'UNDER_INVESTIGATION' THEN 'INVESTIGATE' ELSE 'NO_INVESTIGATION' END,
    "decisionReason" = CASE
      WHEN h."toStatus" = 'AWAITING_CLOSURE'
        THEN NULLIF(regexp_replace(h."reason", '^Review completed — no investigation needed: ', ''), h."reason")
      ELSE NULL END,
    "decidedAt" = h."createdAt"
FROM (
  SELECT DISTINCT ON ("incidentId") "incidentId", "toStatus", "reason", "createdAt"
  FROM "incidents"."IncidentStatusHistory"
  WHERE "fromStatus" = 'UNDER_REVIEW' AND "reason" LIKE 'Review completed%'
  ORDER BY "incidentId", "createdAt" DESC
) h
WHERE h."incidentId" = r."incidentId" AND r."decision" IS NULL;

CREATE TABLE "incidents"."IncidentReviewCycle" (
    "id" UUID NOT NULL,
    "incidentId" UUID NOT NULL,
    "cycleNumber" INTEGER NOT NULL,
    "confirmedSeverity" "incidents"."IncidentSeverity",
    "investigationRequired" BOOLEAN,
    "safeguardingConcern" BOOLEAN,
    "possibleAbuseOrNeglect" BOOLEAN,
    "furtherMedicalAttention" BOOLEAN,
    "externalNotificationRequired" BOOLEAN,
    "escalationRequired" BOOLEAN,
    "immediateRisk" BOOLEAN,
    "protectiveAction" TEXT,
    "managementNotes" TEXT,
    "decision" VARCHAR(30),
    "decisionReason" TEXT,
    "decidedAt" TIMESTAMP(3),
    "reviewedById" UUID,
    "reviewedAt" TIMESTAMP(3),
    "lastUpdatedById" UUID,
    "lastUpdatedAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "archivedById" UUID,
    "reopenReason" TEXT,
    CONSTRAINT "IncidentReviewCycle_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "IncidentReviewCycle_incidentId_cycleNumber_key" ON "incidents"."IncidentReviewCycle"("incidentId", "cycleNumber");
ALTER TABLE "incidents"."IncidentReviewCycle" ADD CONSTRAINT "IncidentReviewCycle_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "incidents"."Incident"("id") ON DELETE CASCADE ON UPDATE CASCADE;
