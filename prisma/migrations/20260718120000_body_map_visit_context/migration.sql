-- Link body map records to scheduled visits (point-of-care documentation).
ALTER TYPE "service_users"."BodyMapLinkedModule" ADD VALUE IF NOT EXISTS 'SCHEDULED_VISIT';

ALTER TABLE "service_users"."BodyMapRecord"
  ADD COLUMN IF NOT EXISTS "scheduledJobId" UUID,
  ADD COLUMN IF NOT EXISTS "scheduledVisitId" UUID;

CREATE INDEX IF NOT EXISTS "BodyMapRecord_scheduledJobId_idx"
  ON "service_users"."BodyMapRecord"("scheduledJobId");

CREATE INDEX IF NOT EXISTS "BodyMapRecord_scheduledVisitId_idx"
  ON "service_users"."BodyMapRecord"("scheduledVisitId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'BodyMapRecord_scheduledJobId_fkey'
  ) THEN
    ALTER TABLE "service_users"."BodyMapRecord"
      ADD CONSTRAINT "BodyMapRecord_scheduledJobId_fkey"
      FOREIGN KEY ("scheduledJobId") REFERENCES "scheduling"."ScheduledJob"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'BodyMapRecord_scheduledVisitId_fkey'
  ) THEN
    ALTER TABLE "service_users"."BodyMapRecord"
      ADD CONSTRAINT "BodyMapRecord_scheduledVisitId_fkey"
      FOREIGN KEY ("scheduledVisitId") REFERENCES "scheduling"."ScheduledVisit"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
