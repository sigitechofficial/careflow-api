-- Administration event: on-behalf entry + correction audit fields

ALTER TABLE "service_users"."MedicationAdministrationEvent"
  ADD COLUMN IF NOT EXISTS "enteredById" UUID,
  ADD COLUMN IF NOT EXISTS "correctionReason" TEXT,
  ADD COLUMN IF NOT EXISTS "correctionNotes" TEXT;

ALTER TABLE "service_users"."MedicationAdministrationEvent"
  ADD CONSTRAINT "MedicationAdministrationEvent_enteredById_fkey"
  FOREIGN KEY ("enteredById") REFERENCES "identity"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
