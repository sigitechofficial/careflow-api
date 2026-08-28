-- ECM Phase 1 foundation: evaluation record + classification enums (parallel to rota statuses)

CREATE TYPE "scheduling"."EcmLifecycleStatus" AS ENUM (
  'DRAFT',
  'SCHEDULED',
  'UNASSIGNED',
  'ASSIGNED',
  'EN_ROUTE',
  'DUE',
  'CHECKED_IN',
  'IN_PROGRESS',
  'CHECKED_OUT',
  'COMPLETED',
  'COMPLETED_WITH_EXCEPTION',
  'CLOSED'
);

CREATE TYPE "scheduling"."EcmCriticality" AS ENUM (
  'STANDARD',
  'PRIORITY',
  'TIME_CRITICAL'
);

CREATE TYPE "scheduling"."EcmSettingsLevel" AS ENUM (
  'PLATFORM',
  'ORGANISATION',
  'BRANCH',
  'CONTRACT',
  'SERVICE_USER',
  'VISIT_TEMPLATE',
  'VISIT'
);

CREATE TYPE "scheduling"."EcmArrivalClassification" AS ENUM (
  'EARLY_ARRIVAL',
  'ON_TIME',
  'LATE_ARRIVAL',
  'VERY_LATE_ARRIVAL',
  'NOT_ASSESSED'
);

CREATE TYPE "scheduling"."EcmDepartureClassification" AS ENUM (
  'EARLY_DEPARTURE',
  'ON_TIME',
  'LATE_DEPARTURE',
  'NOT_ASSESSED'
);

CREATE TYPE "scheduling"."EcmDurationClassification" AS ENUM (
  'SHORT_VISIT',
  'ON_TIME',
  'LONG_VISIT',
  'EXCESSIVE_OVERRUN',
  'NOT_ASSESSED'
);

CREATE TYPE "scheduling"."EcmMissedClassification" AS ENUM (
  'NONE',
  'POTENTIAL_MISSED',
  'ATTENDANCE_VERIFICATION_PENDING',
  'CONFIRMED_MISSED',
  'FALSE_ECM_ALERT',
  'DISPUTED'
);

CREATE TYPE "scheduling"."EcmAttendanceConfidence" AS ENUM (
  'VERIFIED',
  'PARTIALLY_VERIFIED',
  'MANUALLY_VERIFIED',
  'UNVERIFIED',
  'DISPUTED',
  'REJECTED'
);

CREATE TABLE "scheduling"."EcmVisitEvaluation" (
  "id" UUID NOT NULL,
  "scheduledJobId" UUID NOT NULL,
  "scheduledVisitId" UUID,
  "plannedStartDateTime" TIMESTAMP(3) NOT NULL,
  "plannedEndDateTime" TIMESTAMP(3),
  "plannedDurationMinutes" INTEGER,
  "earliestPermittedStart" TIMESTAMP(3),
  "latestPermittedStart" TIMESTAMP(3),
  "minPermittedDurationMinutes" INTEGER,
  "maxPermittedDurationMinutes" INTEGER,
  "criticality" "scheduling"."EcmCriticality" NOT NULL DEFAULT 'STANDARD',
  "requiredCarers" INTEGER NOT NULL DEFAULT 1,
  "localVisitDate" DATE NOT NULL,
  "timezone" TEXT NOT NULL DEFAULT 'Europe/London',
  "actualCheckInAt" TIMESTAMP(3),
  "actualCheckOutAt" TIMESTAMP(3),
  "actualDurationMinutes" INTEGER,
  "startVarianceMinutes" INTEGER,
  "endVarianceMinutes" INTEGER,
  "durationVarianceMinutes" INTEGER,
  "arrivalClassification" "scheduling"."EcmArrivalClassification" NOT NULL DEFAULT 'NOT_ASSESSED',
  "departureClassification" "scheduling"."EcmDepartureClassification" NOT NULL DEFAULT 'NOT_ASSESSED',
  "durationClassification" "scheduling"."EcmDurationClassification" NOT NULL DEFAULT 'NOT_ASSESSED',
  "lifecycleStatus" "scheduling"."EcmLifecycleStatus" NOT NULL DEFAULT 'SCHEDULED',
  "missedClassification" "scheduling"."EcmMissedClassification" NOT NULL DEFAULT 'NONE',
  "operationalExceptionCodes" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "confidence" "scheduling"."EcmAttendanceConfidence" NOT NULL DEFAULT 'UNVERIFIED',
  "appliedSettingsLevel" "scheduling"."EcmSettingsLevel" NOT NULL DEFAULT 'ORGANISATION',
  "lateArrivalToleranceMinutes" INTEGER NOT NULL,
  "veryLateThresholdMinutes" INTEGER NOT NULL,
  "shortVisitToleranceMinutes" INTEGER NOT NULL,
  "longVisitToleranceMinutes" INTEGER NOT NULL,
  "excessiveOverrunMinutes" INTEGER NOT NULL,
  "missedVisitThresholdMinutes" INTEGER NOT NULL,
  "geofenceRadiusMeters" INTEGER,
  "thresholdRuleVersion" TEXT,
  "evaluatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EcmVisitEvaluation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EcmVisitEvaluation_scheduledJobId_key"
  ON "scheduling"."EcmVisitEvaluation"("scheduledJobId");
CREATE INDEX "EcmVisitEvaluation_lifecycleStatus_idx"
  ON "scheduling"."EcmVisitEvaluation"("lifecycleStatus");
CREATE INDEX "EcmVisitEvaluation_arrivalClassification_idx"
  ON "scheduling"."EcmVisitEvaluation"("arrivalClassification");
CREATE INDEX "EcmVisitEvaluation_missedClassification_idx"
  ON "scheduling"."EcmVisitEvaluation"("missedClassification");
CREATE INDEX "EcmVisitEvaluation_confidence_idx"
  ON "scheduling"."EcmVisitEvaluation"("confidence");
CREATE INDEX "EcmVisitEvaluation_localVisitDate_idx"
  ON "scheduling"."EcmVisitEvaluation"("localVisitDate");
CREATE INDEX "EcmVisitEvaluation_evaluatedAt_idx"
  ON "scheduling"."EcmVisitEvaluation"("evaluatedAt");
CREATE INDEX "EcmVisitEvaluation_criticality_idx"
  ON "scheduling"."EcmVisitEvaluation"("criticality");

ALTER TABLE "scheduling"."EcmVisitEvaluation"
  ADD CONSTRAINT "EcmVisitEvaluation_scheduledJobId_fkey"
  FOREIGN KEY ("scheduledJobId") REFERENCES "scheduling"."ScheduledJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "scheduling"."EcmVisitEvaluation"
  ADD CONSTRAINT "EcmVisitEvaluation_scheduledVisitId_fkey"
  FOREIGN KEY ("scheduledVisitId") REFERENCES "scheduling"."ScheduledVisit"("id") ON DELETE SET NULL ON UPDATE CASCADE;
