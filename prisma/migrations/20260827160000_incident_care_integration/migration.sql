-- CreateEnum
CREATE TYPE "incidents"."IncidentInjurySeverity" AS ENUM ('MINOR', 'MODERATE', 'SERIOUS', 'FATAL');

-- CreateEnum
CREATE TYPE "incidents"."IncidentPersonKind" AS ENUM ('SERVICE_USER', 'EMPLOYEE', 'FAMILY', 'VISITOR', 'HEALTHCARE_PROFESSIONAL', 'CONTRACTOR', 'OTHER');

-- CreateEnum
CREATE TYPE "incidents"."IncidentRelatedRecordType" AS ENUM ('CARE_PLAN', 'RISK_ASSESSMENT', 'MEDICATION', 'BODY_MAP', 'DAILY_NOTES', 'VISIT', 'BEHAVIOUR', 'OTHER');

-- CreateEnum
CREATE TYPE "incidents"."IncidentRelatedRecordStatus" AS ENUM ('REVIEW_REQUIRED', 'UPDATED');

-- CreateEnum
CREATE TYPE "incidents"."IncidentAttachmentCategory" AS ENUM ('INCIDENT_PHOTO', 'INJURY_PHOTO', 'WITNESS_EVIDENCE', 'MEDICAL_DOCUMENT', 'NOTIFICATION_EVIDENCE', 'INVESTIGATION_DOCUMENT', 'OTHER');


-- CreateTable
CREATE TABLE "incidents"."IncidentInjury" (
    "id" UUID NOT NULL,
    "incidentId" UUID NOT NULL,
    "personKind" "incidents"."IncidentPersonKind" NOT NULL DEFAULT 'SERVICE_USER',
    "personServiceUserId" UUID,
    "personEmployeeId" UUID,
    "personName" TEXT,
    "injurySeverity" "incidents"."IncidentInjurySeverity" NOT NULL DEFAULT 'MINOR',
    "injuryType" TEXT NOT NULL,
    "bodyRegion" TEXT,
    "side" TEXT,
    "notes" TEXT,
    "measurements" TEXT,
    "bodyMapRecordId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdById" UUID,

    CONSTRAINT "IncidentInjury_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "incidents"."IncidentWitness" (
    "id" UUID NOT NULL,
    "incidentId" UUID NOT NULL,
    "personKind" "incidents"."IncidentPersonKind" NOT NULL DEFAULT 'OTHER',
    "personServiceUserId" UUID,
    "personEmployeeId" UUID,
    "personName" TEXT,
    "statement" TEXT,
    "statementDate" TIMESTAMP(3),
    "addedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "IncidentWitness_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "incidents"."IncidentRelatedCareRecord" (
    "id" UUID NOT NULL,
    "incidentId" UUID NOT NULL,
    "recordType" "incidents"."IncidentRelatedRecordType" NOT NULL,
    "referenceLabel" TEXT NOT NULL,
    "externalId" UUID,
    "status" "incidents"."IncidentRelatedRecordStatus" NOT NULL DEFAULT 'REVIEW_REQUIRED',
    "note" TEXT,
    "updatedByLabel" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdById" UUID,

    CONSTRAINT "IncidentRelatedCareRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "incidents"."IncidentRelatedIncident" (
    "id" UUID NOT NULL,
    "incidentId" UUID NOT NULL,
    "relatedIncidentId" UUID NOT NULL,
    "note" TEXT,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IncidentRelatedIncident_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "incidents"."IncidentAttachment" (
    "id" UUID NOT NULL,
    "incidentId" UUID NOT NULL,
    "category" "incidents"."IncidentAttachmentCategory" NOT NULL DEFAULT 'OTHER',
    "fileName" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "uploadedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "IncidentAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "IncidentInjury_incidentId_idx" ON "incidents"."IncidentInjury"("incidentId");

-- CreateIndex
CREATE INDEX "IncidentInjury_personServiceUserId_idx" ON "incidents"."IncidentInjury"("personServiceUserId");

-- CreateIndex
CREATE INDEX "IncidentWitness_incidentId_idx" ON "incidents"."IncidentWitness"("incidentId");

-- CreateIndex
CREATE INDEX "IncidentRelatedCareRecord_incidentId_idx" ON "incidents"."IncidentRelatedCareRecord"("incidentId");

-- CreateIndex
CREATE INDEX "IncidentRelatedIncident_incidentId_idx" ON "incidents"."IncidentRelatedIncident"("incidentId");

-- CreateIndex
CREATE INDEX "IncidentRelatedIncident_relatedIncidentId_idx" ON "incidents"."IncidentRelatedIncident"("relatedIncidentId");

-- CreateIndex
CREATE UNIQUE INDEX "IncidentRelatedIncident_incidentId_relatedIncidentId_key" ON "incidents"."IncidentRelatedIncident"("incidentId", "relatedIncidentId");

-- CreateIndex
CREATE INDEX "IncidentAttachment_incidentId_idx" ON "incidents"."IncidentAttachment"("incidentId");

-- AddForeignKey
ALTER TABLE "incidents"."IncidentInjury" ADD CONSTRAINT "IncidentInjury_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "incidents"."Incident"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incidents"."IncidentWitness" ADD CONSTRAINT "IncidentWitness_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "incidents"."Incident"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incidents"."IncidentRelatedCareRecord" ADD CONSTRAINT "IncidentRelatedCareRecord_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "incidents"."Incident"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incidents"."IncidentRelatedIncident" ADD CONSTRAINT "IncidentRelatedIncident_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "incidents"."Incident"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incidents"."IncidentRelatedIncident" ADD CONSTRAINT "IncidentRelatedIncident_relatedIncidentId_fkey" FOREIGN KEY ("relatedIncidentId") REFERENCES "incidents"."Incident"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incidents"."IncidentAttachment" ADD CONSTRAINT "IncidentAttachment_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "incidents"."Incident"("id") ON DELETE CASCADE ON UPDATE CASCADE;
