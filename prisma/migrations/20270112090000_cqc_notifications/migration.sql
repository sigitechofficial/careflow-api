-- Governance -> CQC notifications: statutory notifications (Reg 16 / Reg 18) prepared and tracked in CareFlow.
-- Additive only: new enums and tables in the quality schema.


-- CreateEnum
CREATE TYPE "quality"."CqcNotificationType" AS ENUM ('DEATH', 'SERIOUS_INJURY', 'ABUSE_ALLEGATION', 'POLICE_INCIDENT', 'SERVICE_DISRUPTION');

-- CreateEnum
CREATE TYPE "quality"."CqcNotificationStatus" AS ENUM ('DRAFT', 'READY', 'SUBMITTED', 'ACKNOWLEDGED', 'NOT_REQUIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "quality"."CqcSubmissionMethod" AS ENUM ('PROVIDER_PORTAL', 'EMAIL_FORM');

-- CreateTable
CREATE TABLE "quality"."CqcNotificationNumberSequence" (
    "year" INTEGER NOT NULL,
    "lastValue" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CqcNotificationNumberSequence_pkey" PRIMARY KEY ("year")
);

-- CreateTable
CREATE TABLE "quality"."CqcNotification" (
    "id" UUID NOT NULL,
    "referenceNumber" TEXT NOT NULL,
    "type" "quality"."CqcNotificationType" NOT NULL,
    "status" "quality"."CqcNotificationStatus" NOT NULL DEFAULT 'DRAFT',
    "locationId" UUID NOT NULL,
    "serviceUserId" UUID,
    "incidentId" UUID,
    "safeguardingCaseId" UUID,
    "eventOccurredAt" TIMESTAMP(3),
    "becameAwareAt" TIMESTAMP(3) NOT NULL,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "summary" TEXT,
    "actionsTaken" TEXT,
    "othersInformed" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "details" JSONB NOT NULL DEFAULT '{}',
    "readyAt" TIMESTAMP(3),
    "readyById" UUID,
    "submissionMethod" "quality"."CqcSubmissionMethod",
    "submittedAt" TIMESTAMP(3),
    "submittedById" UUID,
    "submittedSnapshot" JSONB,
    "cqcReference" TEXT,
    "acknowledgedAt" TIMESTAMP(3),
    "closedReason" TEXT,
    "closedAt" TIMESTAMP(3),
    "closedById" UUID,
    "createdById" UUID,
    "updatedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CqcNotification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CqcNotification_referenceNumber_key" ON "quality"."CqcNotification"("referenceNumber");

-- CreateIndex
CREATE INDEX "CqcNotification_locationId_idx" ON "quality"."CqcNotification"("locationId");

-- CreateIndex
CREATE INDEX "CqcNotification_status_dueAt_idx" ON "quality"."CqcNotification"("status", "dueAt");

-- CreateIndex
CREATE INDEX "CqcNotification_type_idx" ON "quality"."CqcNotification"("type");

-- CreateIndex
CREATE INDEX "CqcNotification_serviceUserId_idx" ON "quality"."CqcNotification"("serviceUserId");

-- CreateIndex
CREATE INDEX "CqcNotification_incidentId_idx" ON "quality"."CqcNotification"("incidentId");

-- CreateIndex
CREATE INDEX "CqcNotification_safeguardingCaseId_idx" ON "quality"."CqcNotification"("safeguardingCaseId");

