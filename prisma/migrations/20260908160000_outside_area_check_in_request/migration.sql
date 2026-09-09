-- GPS-only carer requests office to enable Manual check-in for this visit / carer / day.

ALTER TYPE "scheduling"."EcmExceptionKind" ADD VALUE IF NOT EXISTS 'OUTSIDE_AREA_CHECK_IN_REQUEST';

CREATE TYPE "scheduling"."VisitCheckInMethodGrantStatus" AS ENUM (
  'PENDING',
  'AUTHORISED',
  'REJECTED',
  'CONSUMED'
);

CREATE TABLE "scheduling"."VisitCheckInMethodGrant" (
  "id" UUID NOT NULL,
  "scheduledJobId" UUID NOT NULL,
  "employeeId" UUID NOT NULL,
  "operationalDay" TEXT NOT NULL,
  "status" "scheduling"."VisitCheckInMethodGrantStatus" NOT NULL DEFAULT 'PENDING',
  "carerNote" TEXT,
  "latitude" DECIMAL(10,7),
  "longitude" DECIMAL(10,7),
  "accuracyMeters" DECIMAL(8,2),
  "distanceMeters" INTEGER,
  "isMockedLocation" BOOLEAN NOT NULL DEFAULT false,
  "locationUnavailable" BOOLEAN NOT NULL DEFAULT false,
  "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "decidedAt" TIMESTAMP(3),
  "decidedById" UUID,
  "decidedByName" TEXT,
  "officeNote" TEXT,
  "consumedAt" TIMESTAMP(3),
  "ecmExceptionId" UUID,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "VisitCheckInMethodGrant_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "VisitCheckInMethodGrant_ecmExceptionId_key"
  ON "scheduling"."VisitCheckInMethodGrant"("ecmExceptionId");
CREATE INDEX "VisitCheckInMethodGrant_scheduledJobId_employeeId_operationalDay_idx"
  ON "scheduling"."VisitCheckInMethodGrant"("scheduledJobId", "employeeId", "operationalDay");
CREATE INDEX "VisitCheckInMethodGrant_scheduledJobId_status_idx"
  ON "scheduling"."VisitCheckInMethodGrant"("scheduledJobId", "status");
CREATE INDEX "VisitCheckInMethodGrant_employeeId_status_idx"
  ON "scheduling"."VisitCheckInMethodGrant"("employeeId", "status");

ALTER TABLE "scheduling"."VisitCheckInMethodGrant"
  ADD CONSTRAINT "VisitCheckInMethodGrant_scheduledJobId_fkey"
  FOREIGN KEY ("scheduledJobId") REFERENCES "scheduling"."ScheduledJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "scheduling"."VisitCheckInMethodGrant"
  ADD CONSTRAINT "VisitCheckInMethodGrant_ecmExceptionId_fkey"
  FOREIGN KEY ("ecmExceptionId") REFERENCES "scheduling"."EcmException"("id") ON DELETE SET NULL ON UPDATE CASCADE;
