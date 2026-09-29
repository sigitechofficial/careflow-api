-- CreateEnum
CREATE TYPE "incidents"."IncidentInvestigationScope" AS ENUM ('INTERNAL', 'EXTERNAL');

-- CreateEnum
CREATE TYPE "incidents"."IncidentExternalInvestigationType" AS ENUM ('POLICE', 'AGENCY', 'COMBINED');

-- AlterTable
ALTER TABLE "incidents"."IncidentInvestigation"
  ADD COLUMN "investigationScope" "incidents"."IncidentInvestigationScope",
  ADD COLUMN "externalType" "incidents"."IncidentExternalInvestigationType";
