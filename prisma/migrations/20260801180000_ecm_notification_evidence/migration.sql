-- ECM notification evidence (GAP3) + health/reporting support indexes

CREATE TYPE "scheduling"."EcmNotificationMethod" AS ENUM (
  'PHONE',
  'SMS',
  'EMAIL',
  'IN_APP',
  'IN_PERSON',
  'OTHER'
);

CREATE TYPE "scheduling"."EcmNotificationOutcome" AS ENUM (
  'ATTEMPTED',
  'ANSWERED',
  'DELIVERED',
  'READ',
  'NO_ANSWER',
  'FAILED',
  'ACCEPTED',
  'DECLINED'
);

CREATE TABLE "scheduling"."EcmNotificationEvidence" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "scheduledJobId" UUID NOT NULL,
  "ecmExceptionId" UUID,
  "contactedByUserId" UUID,
  "contactName" TEXT,
  "contactRole" TEXT,
  "method" "scheduling"."EcmNotificationMethod" NOT NULL,
  "outcome" "scheduling"."EcmNotificationOutcome" NOT NULL DEFAULT 'ATTEMPTED',
  "attemptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "answeredAt" TIMESTAMP(3),
  "deliveredAt" TIMESTAMP(3),
  "readAt" TIMESTAMP(3),
  "etaGiven" TEXT,
  "reasonGiven" TEXT,
  "replacementDetails" TEXT,
  "acceptedDeclined" TEXT,
  "proofUrl" TEXT,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EcmNotificationEvidence_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "EcmNotificationEvidence_scheduledJobId_attemptedAt_idx"
  ON "scheduling"."EcmNotificationEvidence"("scheduledJobId", "attemptedAt");
CREATE INDEX "EcmNotificationEvidence_ecmExceptionId_idx"
  ON "scheduling"."EcmNotificationEvidence"("ecmExceptionId");
CREATE INDEX "EcmNotificationEvidence_outcome_idx"
  ON "scheduling"."EcmNotificationEvidence"("outcome");

ALTER TABLE "scheduling"."EcmNotificationEvidence"
  ADD CONSTRAINT "EcmNotificationEvidence_scheduledJobId_fkey"
  FOREIGN KEY ("scheduledJobId") REFERENCES "scheduling"."ScheduledJob"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "scheduling"."EcmNotificationEvidence"
  ADD CONSTRAINT "EcmNotificationEvidence_ecmExceptionId_fkey"
  FOREIGN KEY ("ecmExceptionId") REFERENCES "scheduling"."EcmException"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
