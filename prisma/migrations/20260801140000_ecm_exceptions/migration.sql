-- ECM exceptions with accountable lifecycle (ack → resolve → close)

CREATE TYPE "scheduling"."EcmExceptionKind" AS ENUM (
  'LATE_ARRIVAL',
  'VERY_LATE_ARRIVAL',
  'EARLY_ARRIVAL',
  'EARLY_DEPARTURE',
  'SHORT_VISIT',
  'LONG_VISIT',
  'EXCESSIVE_OVERRUN',
  'POTENTIAL_MISSED',
  'CONFIRMED_MISSED',
  'MISSING_CHECKOUT',
  'OUTSIDE_GEOFENCE',
  'MANUAL_ATTENDANCE',
  'MOCK_LOCATION',
  'OTHER'
);

CREATE TYPE "scheduling"."EcmExceptionLifecycle" AS ENUM (
  'DETECTED',
  'ALERT_GENERATED',
  'ASSIGNED',
  'ACKNOWLEDGED',
  'INVESTIGATING',
  'ACTION_TAKEN',
  'RESOLVED',
  'MANAGER_REVIEWED',
  'CLOSED'
);

CREATE TABLE "scheduling"."EcmException" (
  "id" UUID NOT NULL,
  "scheduledJobId" UUID NOT NULL,
  "ecmVisitEvaluationId" UUID,
  "kind" "scheduling"."EcmExceptionKind" NOT NULL,
  "lifecycle" "scheduling"."EcmExceptionLifecycle" NOT NULL DEFAULT 'DETECTED',
  "title" TEXT NOT NULL,
  "detail" TEXT,
  "reasonCode" TEXT,
  "resolutionNote" TEXT,
  "ownerUserId" UUID,
  "acknowledgedAt" TIMESTAMP(3),
  "acknowledgedById" UUID,
  "firstActionAt" TIMESTAMP(3),
  "resolvedAt" TIMESTAMP(3),
  "resolvedById" UUID,
  "closedAt" TIMESTAMP(3),
  "closedById" UUID,
  "responseTargetMinutes" INTEGER,
  "escalationDeadlineAt" TIMESTAMP(3),
  "overdue" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EcmException_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "EcmException_scheduledJobId_idx" ON "scheduling"."EcmException"("scheduledJobId");
CREATE INDEX "EcmException_lifecycle_idx" ON "scheduling"."EcmException"("lifecycle");
CREATE INDEX "EcmException_kind_idx" ON "scheduling"."EcmException"("kind");
CREATE INDEX "EcmException_overdue_idx" ON "scheduling"."EcmException"("overdue");
CREATE INDEX "EcmException_createdAt_idx" ON "scheduling"."EcmException"("createdAt");

ALTER TABLE "scheduling"."EcmException"
  ADD CONSTRAINT "EcmException_scheduledJobId_fkey"
  FOREIGN KEY ("scheduledJobId") REFERENCES "scheduling"."ScheduledJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "scheduling"."EcmException"
  ADD CONSTRAINT "EcmException_ecmVisitEvaluationId_fkey"
  FOREIGN KEY ("ecmVisitEvaluationId") REFERENCES "scheduling"."EcmVisitEvaluation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
