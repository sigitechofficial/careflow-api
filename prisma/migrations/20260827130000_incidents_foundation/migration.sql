-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "incidents";

-- CreateEnum
CREATE TYPE "incidents"."IncidentStatus" AS ENUM ('REPORTED', 'AWAITING_REVIEW', 'UNDER_INVESTIGATION', 'ACTIONS_REQUIRED', 'AWAITING_CLOSURE', 'CLOSED', 'REOPENED');

-- CreateEnum
CREATE TYPE "incidents"."IncidentSeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "incidents"."IncidentPrivacyLevel" AS ENUM ('NORMAL', 'RESTRICTED', 'HIGHLY_CONFIDENTIAL');

-- CreateTable
CREATE TABLE "incidents"."IncidentCategory" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "IncidentCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "incidents"."IncidentSubtype" (
    "id" UUID NOT NULL,
    "categoryId" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "IncidentSubtype_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "incidents"."IncidentNumberSequence" (
    "year" INTEGER NOT NULL,
    "lastValue" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IncidentNumberSequence_pkey" PRIMARY KEY ("year")
);

-- CreateTable
CREATE TABLE "incidents"."Incident" (
    "id" UUID NOT NULL,
    "referenceNumber" TEXT NOT NULL,
    "categoryId" UUID NOT NULL,
    "subtypeId" UUID,
    "status" "incidents"."IncidentStatus" NOT NULL DEFAULT 'REPORTED',
    "severity" "incidents"."IncidentSeverity" NOT NULL DEFAULT 'LOW',
    "privacyLevel" "incidents"."IncidentPrivacyLevel" NOT NULL DEFAULT 'NORMAL',
    "shareWithHandover" BOOLEAN NOT NULL DEFAULT false,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "locationId" UUID,
    "specificArea" TEXT,
    "reportedById" UUID,
    "reporterEmployeeId" UUID,
    "primaryServiceUserId" UUID,
    "primaryEmployeeId" UUID,
    "description" TEXT NOT NULL DEFAULT '',
    "contextBefore" TEXT,
    "contextAfter" TEXT,
    "immediateActions" TEXT,
    "immediateActionCodes" TEXT[],
    "injuryOccurred" BOOLEAN NOT NULL DEFAULT false,
    "ownerId" UUID,
    "reportedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdById" UUID,
    "updatedById" UUID,
    "deletedById" UUID,

    CONSTRAINT "Incident_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "incidents"."IncidentStatusHistory" (
    "id" UUID NOT NULL,
    "incidentId" UUID NOT NULL,
    "fromStatus" "incidents"."IncidentStatus",
    "toStatus" "incidents"."IncidentStatus" NOT NULL,
    "changedById" UUID,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IncidentStatusHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "incidents"."IncidentSeverityHistory" (
    "id" UUID NOT NULL,
    "incidentId" UUID NOT NULL,
    "fromSeverity" "incidents"."IncidentSeverity",
    "toSeverity" "incidents"."IncidentSeverity" NOT NULL,
    "changedById" UUID,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IncidentSeverityHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "IncidentCategory_key_key" ON "incidents"."IncidentCategory"("key");

-- CreateIndex
CREATE INDEX "IncidentCategory_isActive_idx" ON "incidents"."IncidentCategory"("isActive");

-- CreateIndex
CREATE INDEX "IncidentCategory_deletedAt_idx" ON "incidents"."IncidentCategory"("deletedAt");

-- CreateIndex
CREATE INDEX "IncidentSubtype_categoryId_idx" ON "incidents"."IncidentSubtype"("categoryId");

-- CreateIndex
CREATE INDEX "IncidentSubtype_isActive_idx" ON "incidents"."IncidentSubtype"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "IncidentSubtype_categoryId_key_key" ON "incidents"."IncidentSubtype"("categoryId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "Incident_referenceNumber_key" ON "incidents"."Incident"("referenceNumber");

-- CreateIndex
CREATE INDEX "Incident_status_idx" ON "incidents"."Incident"("status");

-- CreateIndex
CREATE INDEX "Incident_severity_idx" ON "incidents"."Incident"("severity");

-- CreateIndex
CREATE INDEX "Incident_privacyLevel_idx" ON "incidents"."Incident"("privacyLevel");

-- CreateIndex
CREATE INDEX "Incident_categoryId_idx" ON "incidents"."Incident"("categoryId");

-- CreateIndex
CREATE INDEX "Incident_subtypeId_idx" ON "incidents"."Incident"("subtypeId");

-- CreateIndex
CREATE INDEX "Incident_primaryServiceUserId_idx" ON "incidents"."Incident"("primaryServiceUserId");

-- CreateIndex
CREATE INDEX "Incident_primaryEmployeeId_idx" ON "incidents"."Incident"("primaryEmployeeId");

-- CreateIndex
CREATE INDEX "Incident_locationId_idx" ON "incidents"."Incident"("locationId");

-- CreateIndex
CREATE INDEX "Incident_ownerId_idx" ON "incidents"."Incident"("ownerId");

-- CreateIndex
CREATE INDEX "Incident_occurredAt_idx" ON "incidents"."Incident"("occurredAt");

-- CreateIndex
CREATE INDEX "Incident_reportedAt_idx" ON "incidents"."Incident"("reportedAt");

-- CreateIndex
CREATE INDEX "Incident_isArchived_idx" ON "incidents"."Incident"("isArchived");

-- CreateIndex
CREATE INDEX "Incident_deletedAt_idx" ON "incidents"."Incident"("deletedAt");

-- CreateIndex
CREATE INDEX "IncidentStatusHistory_incidentId_createdAt_idx" ON "incidents"."IncidentStatusHistory"("incidentId", "createdAt");

-- CreateIndex
CREATE INDEX "IncidentSeverityHistory_incidentId_createdAt_idx" ON "incidents"."IncidentSeverityHistory"("incidentId", "createdAt");

-- AddForeignKey
ALTER TABLE "incidents"."IncidentSubtype" ADD CONSTRAINT "IncidentSubtype_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "incidents"."IncidentCategory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incidents"."Incident" ADD CONSTRAINT "Incident_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "incidents"."IncidentCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incidents"."Incident" ADD CONSTRAINT "Incident_subtypeId_fkey" FOREIGN KEY ("subtypeId") REFERENCES "incidents"."IncidentSubtype"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incidents"."IncidentStatusHistory" ADD CONSTRAINT "IncidentStatusHistory_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "incidents"."Incident"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incidents"."IncidentSeverityHistory" ADD CONSTRAINT "IncidentSeverityHistory_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "incidents"."Incident"("id") ON DELETE CASCADE ON UPDATE CASCADE;
