-- Zone geography + branch address for Location Management table UI
ALTER TABLE "lookups"."Zone" ADD COLUMN IF NOT EXISTS "country" TEXT;
ALTER TABLE "lookups"."Zone" ADD COLUMN IF NOT EXISTS "city" TEXT;

ALTER TABLE "scheduling"."ScheduleArea" ADD COLUMN IF NOT EXISTS "address" TEXT;
