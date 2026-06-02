-- CreateEnum
CREATE TYPE "service_users"."BodyMapEmollientFireRisk" AS ENUM ('NOT_APPLICABLE', 'NOT_ASSESSED', 'LOW', 'MEDIUM', 'HIGH');

-- AlterEnum
ALTER TYPE "service_users"."BodyMapAuditAction" ADD VALUE 'MEDICATION_SITE_CREATE';
ALTER TYPE "service_users"."BodyMapAuditAction" ADD VALUE 'MEDICATION_SITE_UPDATE';

-- CreateTable
CREATE TABLE "service_users"."BodyMapMedicationSite" (
    "id" UUID NOT NULL,
    "bodyMapRecordId" UUID NOT NULL,
    "serviceUserMedicationId" UUID NOT NULL,
    "lastAdministrationEventId" UUID,
    "medicineNameSnapshot" TEXT NOT NULL,
    "strength" TEXT,
    "frequencyText" TEXT,
    "appliedAt" TIMESTAMP(3),
    "appliedById" UUID,
    "consentGiven" BOOLEAN,
    "marLinkedAt" TIMESTAMP(3),
    "amountOrThickness" TEXT,
    "reasonForApplication" TEXT,
    "fireRiskEmollient" "service_users"."BodyMapEmollientFireRisk",
    "outcomeNote" TEXT,
    "oldPatchPresent" BOOLEAN,
    "oldPatchRemoved" BOOLEAN,
    "oldPatchRemovalAt" TIMESTAMP(3),
    "oldPatchBodyPart" TEXT,
    "oldPatchNotes" TEXT,
    "disposalRecorded" BOOLEAN,
    "nextChangeDue" TIMESTAMP(3),
    "siteRotationChecked" BOOLEAN,
    "secondStaffCheck" BOOLEAN,
    "siteRotationNotes" TEXT,
    "assessmentData" JSONB,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BodyMapMedicationSite_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BodyMapMedicationSite_bodyMapRecordId_key" ON "service_users"."BodyMapMedicationSite"("bodyMapRecordId");

-- CreateIndex
CREATE INDEX "BodyMapMedicationSite_serviceUserMedicationId_idx" ON "service_users"."BodyMapMedicationSite"("serviceUserMedicationId");

-- CreateIndex
CREATE INDEX "BodyMapMedicationSite_lastAdministrationEventId_idx" ON "service_users"."BodyMapMedicationSite"("lastAdministrationEventId");

-- CreateIndex
CREATE INDEX "BodyMapMedicationSite_nextChangeDue_idx" ON "service_users"."BodyMapMedicationSite"("nextChangeDue");

-- AddForeignKey
ALTER TABLE "service_users"."BodyMapMedicationSite" ADD CONSTRAINT "BodyMapMedicationSite_bodyMapRecordId_fkey" FOREIGN KEY ("bodyMapRecordId") REFERENCES "service_users"."BodyMapRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_users"."BodyMapMedicationSite" ADD CONSTRAINT "BodyMapMedicationSite_serviceUserMedicationId_fkey" FOREIGN KEY ("serviceUserMedicationId") REFERENCES "service_users"."ServiceUserMedication"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_users"."BodyMapMedicationSite" ADD CONSTRAINT "BodyMapMedicationSite_lastAdministrationEventId_fkey" FOREIGN KEY ("lastAdministrationEventId") REFERENCES "service_users"."MedicationAdministrationEvent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_users"."BodyMapMedicationSite" ADD CONSTRAINT "BodyMapMedicationSite_appliedById_fkey" FOREIGN KEY ("appliedById") REFERENCES "identity"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_users"."BodyMapMedicationSite" ADD CONSTRAINT "BodyMapMedicationSite_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "identity"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
