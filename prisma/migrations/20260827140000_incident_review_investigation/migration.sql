-- CreateEnum
CREATE TYPE "incidents"."IncidentPreventability" AS ENUM ('YES', 'NO', 'PARTIALLY', 'UNKNOWN');


-- CreateTable
CREATE TABLE "incidents"."IncidentReview" (
    "id" UUID NOT NULL,
    "incidentId" UUID NOT NULL,
    "confirmedSeverity" "incidents"."IncidentSeverity",
    "investigationRequired" BOOLEAN,
    "safeguardingConcern" BOOLEAN,
    "possibleAbuseOrNeglect" BOOLEAN,
    "furtherMedicalAttention" BOOLEAN,
    "externalNotificationRequired" BOOLEAN,
    "escalationRequired" BOOLEAN,
    "managementNotes" TEXT,
    "reviewedById" UUID,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" UUID,
    "updatedById" UUID,

    CONSTRAINT "IncidentReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "incidents"."IncidentInvestigation" (
    "id" UUID NOT NULL,
    "incidentId" UUID NOT NULL,
    "whatHappened" TEXT,
    "whyHappened" TEXT,
    "contributingFactors" TEXT[],
    "rootCause" TEXT,
    "preventable" "incidents"."IncidentPreventability",
    "conclusion" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" UUID,
    "updatedById" UUID,

    CONSTRAINT "IncidentInvestigation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "IncidentReview_incidentId_key" ON "incidents"."IncidentReview"("incidentId");

-- CreateIndex
CREATE UNIQUE INDEX "IncidentInvestigation_incidentId_key" ON "incidents"."IncidentInvestigation"("incidentId");

-- AddForeignKey
ALTER TABLE "incidents"."IncidentReview" ADD CONSTRAINT "IncidentReview_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "incidents"."Incident"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incidents"."IncidentInvestigation" ADD CONSTRAINT "IncidentInvestigation_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "incidents"."Incident"("id") ON DELETE CASCADE ON UPDATE CASCADE;
