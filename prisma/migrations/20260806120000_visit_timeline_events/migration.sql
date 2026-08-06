-- Durable visit timeline events for employee-app GET details → data.log.timeline
CREATE TABLE IF NOT EXISTS "scheduling"."VisitTimelineEvent" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "scheduledJobId" UUID NOT NULL,
    "scheduledVisitId" UUID,
    "eventType" VARCHAR(32) NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "timeLabel" VARCHAR(8),
    "title" TEXT NOT NULL,
    "detail" TEXT,
    "tone" VARCHAR(16),
    "sourceType" VARCHAR(32) NOT NULL,
    "sourceId" VARCHAR(128) NOT NULL,
    "logEntryId" VARCHAR(128),
    "isDraft" BOOLEAN NOT NULL DEFAULT false,
    "idempotencyKey" VARCHAR(128),
    "createdByEmployeeId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VisitTimelineEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "VisitTimelineEvent_idempotencyKey_key"
  ON "scheduling"."VisitTimelineEvent"("idempotencyKey");

CREATE UNIQUE INDEX IF NOT EXISTS "VisitTimelineEvent_scheduledJobId_sourceType_sourceId_eventType_key"
  ON "scheduling"."VisitTimelineEvent"("scheduledJobId", "sourceType", "sourceId", "eventType");

CREATE INDEX IF NOT EXISTS "VisitTimelineEvent_scheduledJobId_occurredAt_idx"
  ON "scheduling"."VisitTimelineEvent"("scheduledJobId", "occurredAt");

CREATE INDEX IF NOT EXISTS "VisitTimelineEvent_scheduledJobId_isDraft_idx"
  ON "scheduling"."VisitTimelineEvent"("scheduledJobId", "isDraft");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'VisitTimelineEvent_scheduledJobId_fkey'
  ) THEN
    ALTER TABLE "scheduling"."VisitTimelineEvent"
      ADD CONSTRAINT "VisitTimelineEvent_scheduledJobId_fkey"
      FOREIGN KEY ("scheduledJobId") REFERENCES "scheduling"."ScheduledJob"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
