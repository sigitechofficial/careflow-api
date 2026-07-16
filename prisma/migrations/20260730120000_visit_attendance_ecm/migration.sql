-- Electronic Call Monitoring: append-only attendance evidence + late-alert dedupe

CREATE TYPE "scheduling"."VisitAttendanceEventType" AS ENUM ('CHECK_IN', 'CHECK_OUT', 'EN_ROUTE');
CREATE TYPE "scheduling"."VisitAttendanceVerificationMethod" AS ENUM (
  'MOBILE_GPS',
  'MANUAL_OFFICE',
  'NFC',
  'QR',
  'TELEPHONE',
  'OTHER'
);
CREATE TYPE "scheduling"."LateVisitAlertKind" AS ENUM ('LATE_START', 'NOT_STARTED_PAST_END');

CREATE TABLE "scheduling"."VisitAttendanceEvent" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "scheduledJobId" UUID NOT NULL,
  "scheduledVisitId" UUID,
  "jobAllocationId" UUID,
  "employeeId" UUID NOT NULL,
  "eventType" "scheduling"."VisitAttendanceEventType" NOT NULL,
  "verificationMethod" "scheduling"."VisitAttendanceVerificationMethod" NOT NULL DEFAULT 'MOBILE_GPS',
  "occurredAt" TIMESTAMP(3) NOT NULL,
  "deviceCapturedAt" TIMESTAMP(3),
  "clientEventId" TEXT,
  "latitude" DECIMAL(10,7),
  "longitude" DECIMAL(10,7),
  "accuracyMeters" DECIMAL(10,2),
  "isMockLocation" BOOLEAN NOT NULL DEFAULT false,
  "outsideGeofence" BOOLEAN NOT NULL DEFAULT false,
  "outsideGeofenceReason" TEXT,
  "distanceMeters" INTEGER,
  "identityConfirmed" BOOLEAN NOT NULL DEFAULT false,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "VisitAttendanceEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "scheduling"."LateVisitAlertLog" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "scheduledJobId" UUID NOT NULL,
  "alertKind" "scheduling"."LateVisitAlertKind" NOT NULL,
  "thresholdMinutes" INTEGER NOT NULL,
  "scheduledStart" TIMESTAMP(3) NOT NULL,
  "alertedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "channels" JSONB,
  "recipientCount" INTEGER NOT NULL DEFAULT 0,
  "message" TEXT,
  CONSTRAINT "LateVisitAlertLog_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LateVisitAlertLog_scheduledJobId_alertKind_key"
  ON "scheduling"."LateVisitAlertLog"("scheduledJobId", "alertKind");

CREATE INDEX "VisitAttendanceEvent_scheduledJobId_employeeId_eventType_idx"
  ON "scheduling"."VisitAttendanceEvent"("scheduledJobId", "employeeId", "eventType");
CREATE INDEX "VisitAttendanceEvent_clientEventId_idx"
  ON "scheduling"."VisitAttendanceEvent"("clientEventId");
CREATE INDEX "VisitAttendanceEvent_scheduledJobId_idx"
  ON "scheduling"."VisitAttendanceEvent"("scheduledJobId");
CREATE INDEX "VisitAttendanceEvent_scheduledVisitId_idx"
  ON "scheduling"."VisitAttendanceEvent"("scheduledVisitId");
CREATE INDEX "VisitAttendanceEvent_employeeId_idx"
  ON "scheduling"."VisitAttendanceEvent"("employeeId");
CREATE INDEX "VisitAttendanceEvent_eventType_idx"
  ON "scheduling"."VisitAttendanceEvent"("eventType");
CREATE INDEX "VisitAttendanceEvent_occurredAt_idx"
  ON "scheduling"."VisitAttendanceEvent"("occurredAt");
CREATE INDEX "VisitAttendanceEvent_outsideGeofence_idx"
  ON "scheduling"."VisitAttendanceEvent"("outsideGeofence");
CREATE INDEX "VisitAttendanceEvent_isMockLocation_idx"
  ON "scheduling"."VisitAttendanceEvent"("isMockLocation");
CREATE INDEX "LateVisitAlertLog_alertedAt_idx"
  ON "scheduling"."LateVisitAlertLog"("alertedAt");

-- Idempotent check-in when client supplies an event id
CREATE UNIQUE INDEX "VisitAttendanceEvent_job_employee_type_client_uidx"
  ON "scheduling"."VisitAttendanceEvent"("scheduledJobId", "employeeId", "eventType", "clientEventId")
  WHERE "clientEventId" IS NOT NULL;

ALTER TABLE "scheduling"."VisitAttendanceEvent"
  ADD CONSTRAINT "VisitAttendanceEvent_scheduledJobId_fkey"
  FOREIGN KEY ("scheduledJobId") REFERENCES "scheduling"."ScheduledJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "scheduling"."VisitAttendanceEvent"
  ADD CONSTRAINT "VisitAttendanceEvent_scheduledVisitId_fkey"
  FOREIGN KEY ("scheduledVisitId") REFERENCES "scheduling"."ScheduledVisit"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "scheduling"."VisitAttendanceEvent"
  ADD CONSTRAINT "VisitAttendanceEvent_jobAllocationId_fkey"
  FOREIGN KEY ("jobAllocationId") REFERENCES "scheduling"."JobAllocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "scheduling"."VisitAttendanceEvent"
  ADD CONSTRAINT "VisitAttendanceEvent_employeeId_fkey"
  FOREIGN KEY ("employeeId") REFERENCES "employees"."Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "scheduling"."LateVisitAlertLog"
  ADD CONSTRAINT "LateVisitAlertLog_scheduledJobId_fkey"
  FOREIGN KEY ("scheduledJobId") REFERENCES "scheduling"."ScheduledJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;
