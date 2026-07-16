-- ECM schedule versions (GAP1) + immutable audit trail (BE1.14)

CREATE TYPE "scheduling"."EcmScheduleChangeClass" AS ENUM (
  'ORIGINAL',
  'PLANNED',
  'SERVICE_USER_REQUESTED',
  'PROVIDER_REQUESTED',
  'EMERGENCY',
  'SAME_DAY',
  'LATE_NOTICE',
  'RETROSPECTIVE',
  'UNAUTHORISED'
);

CREATE TABLE "scheduling"."EcmScheduleVersion" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "scheduledJobId" UUID NOT NULL,
  "versionNumber" INTEGER NOT NULL,
  "isOriginal" BOOLEAN NOT NULL DEFAULT false,
  "changeClass" "scheduling"."EcmScheduleChangeClass" NOT NULL DEFAULT 'ORIGINAL',
  "plannedStartDateTime" TIMESTAMP(3) NOT NULL,
  "plannedEndDateTime" TIMESTAMP(3),
  "previousStartDateTime" TIMESTAMP(3),
  "previousEndDateTime" TIMESTAMP(3),
  "reasonCode" TEXT,
  "reasonNote" TEXT,
  "changedById" UUID,
  "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "serviceUserAgreed" BOOLEAN,
  "serviceUserInformed" BOOLEAN,
  "informedAt" TIMESTAMP(3),
  "agreedAt" TIMESTAMP(3),
  "beforeDueTime" BOOLEAN NOT NULL DEFAULT true,
  "lateNotice" BOOLEAN NOT NULL DEFAULT false,
  "retrospective" BOOLEAN NOT NULL DEFAULT false,
  "managerApproved" BOOLEAN,
  "managerApprovedById" UUID,
  "managerApprovedAt" TIMESTAMP(3),
  "commissionerAuthorised" BOOLEAN,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EcmScheduleVersion_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EcmScheduleVersion_scheduledJobId_versionNumber_key"
  ON "scheduling"."EcmScheduleVersion"("scheduledJobId", "versionNumber");
CREATE INDEX "EcmScheduleVersion_scheduledJobId_changedAt_idx"
  ON "scheduling"."EcmScheduleVersion"("scheduledJobId", "changedAt");
CREATE INDEX "EcmScheduleVersion_changeClass_idx"
  ON "scheduling"."EcmScheduleVersion"("changeClass");
CREATE INDEX "EcmScheduleVersion_retrospective_idx"
  ON "scheduling"."EcmScheduleVersion"("retrospective");
CREATE INDEX "EcmScheduleVersion_lateNotice_idx"
  ON "scheduling"."EcmScheduleVersion"("lateNotice");

ALTER TABLE "scheduling"."EcmScheduleVersion"
  ADD CONSTRAINT "EcmScheduleVersion_scheduledJobId_fkey"
  FOREIGN KEY ("scheduledJobId") REFERENCES "scheduling"."ScheduledJob"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TYPE "scheduling"."EcmAuditEventType" AS ENUM (
  'SCHEDULE_VERSION_CREATED',
  'EVALUATION_UPSERTED',
  'EXCEPTION_DETECTED',
  'EXCEPTION_ACKNOWLEDGED',
  'EXCEPTION_RESOLVED',
  'EXCEPTION_CLOSED',
  'ATTENDANCE_AMENDED',
  'ALERT_GENERATED',
  'NOTIFICATION_RECORDED',
  'SETTINGS_CHANGED',
  'MANUAL_OVERRIDE',
  'OTHER'
);

CREATE TABLE "scheduling"."EcmAuditEvent" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "scheduledJobId" UUID,
  "ecmExceptionId" UUID,
  "eventType" "scheduling"."EcmAuditEventType" NOT NULL,
  "actorUserId" UUID,
  "summary" TEXT NOT NULL,
  "detail" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EcmAuditEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "EcmAuditEvent_scheduledJobId_createdAt_idx"
  ON "scheduling"."EcmAuditEvent"("scheduledJobId", "createdAt");
CREATE INDEX "EcmAuditEvent_ecmExceptionId_idx"
  ON "scheduling"."EcmAuditEvent"("ecmExceptionId");
CREATE INDEX "EcmAuditEvent_eventType_idx"
  ON "scheduling"."EcmAuditEvent"("eventType");
CREATE INDEX "EcmAuditEvent_createdAt_idx"
  ON "scheduling"."EcmAuditEvent"("createdAt");
