-- Persist carer-app MAR echo fields for visit medication read-back
ALTER TABLE "service_users"."MedicationAdministrationEvent"
  ADD COLUMN IF NOT EXISTS "supportLevel" VARCHAR(64),
  ADD COLUMN IF NOT EXISTS "timeGiven" VARCHAR(5),
  ADD COLUMN IF NOT EXISTS "outcomeLabel" VARCHAR(128);
