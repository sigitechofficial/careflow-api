-- Per-slot dose on MAR schedules; preserve MAR short code on administration events.
ALTER TABLE "service_users"."MedicationSchedule"
  ADD COLUMN IF NOT EXISTS "dose" VARCHAR(100);

ALTER TABLE "service_users"."MedicationAdministrationEvent"
  ADD COLUMN IF NOT EXISTS "statusCode" VARCHAR(20);
