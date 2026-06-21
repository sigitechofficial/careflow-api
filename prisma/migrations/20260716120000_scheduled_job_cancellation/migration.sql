-- Enterprise visit cancellation / call-off compliance record

CREATE TYPE "scheduling"."VisitCancellationReasonCode" AS ENUM (
  'CLIENT_HOSPITAL_ADMISSION',
  'CLIENT_REQUEST',
  'CLIENT_UNAVAILABLE',
  'VISIT_PLAN_SUSPENDED',
  'SERVICE_NOT_REQUIRED',
  'PROVIDER_UNABLE_TO_STAFF',
  'PROVIDER_ROTA_ERROR',
  'WEATHER_OR_EMERGENCY',
  'DUPLICATE_ENTRY',
  'OTHER'
);

CREATE TYPE "scheduling"."VisitChargeDecision" AS ENUM (
  'CHARGE',
  'NO_CHARGE',
  'WAIVE',
  'PENDING_REVIEW'
);

CREATE TABLE "scheduling"."ScheduledJobCancellation" (
  "id" UUID NOT NULL,
  "scheduledJobId" UUID NOT NULL,
  "scheduledVisitId" UUID,
  "serviceUserId" UUID NOT NULL,
  "outcome" "scheduling"."ScheduledJobStatus" NOT NULL,
  "reasonCode" "scheduling"."VisitCancellationReasonCode" NOT NULL,
  "reasonNotes" TEXT,
  "welfareChecked" BOOLEAN NOT NULL DEFAULT false,
  "familyNotified" BOOLEAN NOT NULL DEFAULT false,
  "commissionerNotified" BOOLEAN NOT NULL DEFAULT false,
  "chargeDecision" "scheduling"."VisitChargeDecision" NOT NULL,
  "chargeDecisionNotes" TEXT,
  "timeCriticalVisit" BOOLEAN NOT NULL DEFAULT false,
  "timeCriticalEscalated" BOOLEAN NOT NULL DEFAULT false,
  "callOffVisitId" UUID,
  "cancelledById" UUID,
  "cancelledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reinstatedAt" TIMESTAMP(3),
  "reinstatedById" UUID,
  "reinstateNotes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ScheduledJobCancellation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ScheduledJobCancellation_scheduledJobId_key"
  ON "scheduling"."ScheduledJobCancellation"("scheduledJobId");
CREATE INDEX "ScheduledJobCancellation_serviceUserId_idx"
  ON "scheduling"."ScheduledJobCancellation"("serviceUserId");
CREATE INDEX "ScheduledJobCancellation_outcome_idx"
  ON "scheduling"."ScheduledJobCancellation"("outcome");
CREATE INDEX "ScheduledJobCancellation_reasonCode_idx"
  ON "scheduling"."ScheduledJobCancellation"("reasonCode");
CREATE INDEX "ScheduledJobCancellation_chargeDecision_idx"
  ON "scheduling"."ScheduledJobCancellation"("chargeDecision");
CREATE INDEX "ScheduledJobCancellation_cancelledAt_idx"
  ON "scheduling"."ScheduledJobCancellation"("cancelledAt");
CREATE INDEX "ScheduledJobCancellation_reinstatedAt_idx"
  ON "scheduling"."ScheduledJobCancellation"("reinstatedAt");

ALTER TABLE "scheduling"."ScheduledJobCancellation"
  ADD CONSTRAINT "ScheduledJobCancellation_scheduledJobId_fkey"
  FOREIGN KEY ("scheduledJobId") REFERENCES "scheduling"."ScheduledJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "scheduling"."ScheduledJobCancellation"
  ADD CONSTRAINT "ScheduledJobCancellation_serviceUserId_fkey"
  FOREIGN KEY ("serviceUserId") REFERENCES "service_users"."ServiceUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "scheduling"."ScheduledJobCancellation"
  ADD CONSTRAINT "ScheduledJobCancellation_cancelledById_fkey"
  FOREIGN KEY ("cancelledById") REFERENCES "identity"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "scheduling"."ScheduledJobCancellation"
  ADD CONSTRAINT "ScheduledJobCancellation_reinstatedById_fkey"
  FOREIGN KEY ("reinstatedById") REFERENCES "identity"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
