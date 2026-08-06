-- Medication storage location for carers (visit details overview.medicationLocation)
ALTER TABLE "service_users"."MedicationSupportProfile"
  ADD COLUMN IF NOT EXISTS "storageLocation" TEXT;
