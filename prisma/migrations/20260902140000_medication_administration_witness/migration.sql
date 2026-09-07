-- Optional controlled-drug witness on the administration record (carer-entered)
ALTER TABLE "service_users"."MedicationAdministrationEvent"
  ADD COLUMN IF NOT EXISTS "witnessPresent" BOOLEAN,
  ADD COLUMN IF NOT EXISTS "witnessName" VARCHAR(200),
  ADD COLUMN IF NOT EXISTS "witnessRelationCode" VARCHAR(32),
  ADD COLUMN IF NOT EXISTS "witnessRelationDetail" VARCHAR(128),
  ADD COLUMN IF NOT EXISTS "witnessNotes" VARCHAR(2000);
