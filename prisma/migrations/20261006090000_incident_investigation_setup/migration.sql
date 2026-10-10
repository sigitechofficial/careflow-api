-- Investigation set-up: level, lead investigator, involvement, target date, terms of reference,
-- investigation status, and pause history. The start date reuses IncidentInvestigation.createdAt.
ALTER TABLE "incidents"."IncidentInvestigation"
  ADD COLUMN "investigationLevel" VARCHAR(20),
  ADD COLUMN "leadInvestigatorId" UUID,
  ADD COLUMN "investigatorInvolved" VARCHAR(20),
  ADD COLUMN "investigatorInvolvedReason" TEXT,
  ADD COLUMN "targetDate" DATE,
  ADD COLUMN "termsOfReference" TEXT,
  ADD COLUMN "investigationStatus" VARCHAR(20) NOT NULL DEFAULT 'IN_PROGRESS';

-- Existing completed investigations keep their completed state.
UPDATE "incidents"."IncidentInvestigation" SET "investigationStatus" = 'COMPLETED' WHERE "completedAt" IS NOT NULL;

CREATE TABLE "incidents"."IncidentInvestigationPause" (
    "id" UUID NOT NULL,
    "incidentId" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "pausedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "pausedById" UUID,
    "nextReviewDate" DATE NOT NULL,
    "resumedAt" TIMESTAMP(3),
    "resumedById" UUID,
    CONSTRAINT "IncidentInvestigationPause_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "IncidentInvestigationPause_incidentId_pausedAt_idx" ON "incidents"."IncidentInvestigationPause"("incidentId", "pausedAt");
ALTER TABLE "incidents"."IncidentInvestigationPause" ADD CONSTRAINT "IncidentInvestigationPause_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "incidents"."Incident"("id") ON DELETE CASCADE ON UPDATE CASCADE;
