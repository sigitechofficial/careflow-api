ALTER TABLE "scheduling"."ScheduledVisitTaskCompletion"
ADD COLUMN IF NOT EXISTS "recordedValue" TEXT;
