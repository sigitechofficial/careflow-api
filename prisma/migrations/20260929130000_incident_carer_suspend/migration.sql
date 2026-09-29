-- AlterTable: carer suspension recorded on investigation
ALTER TABLE "incidents"."IncidentInvestigation"
  ADD COLUMN "carerSuspended" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "suspendedEmployeeId" UUID,
  ADD COLUMN "suspendReason" TEXT,
  ADD COLUMN "suspendedAt" TIMESTAMP(3);
