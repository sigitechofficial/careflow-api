-- Manager review + point-in-time snapshots on administration events

ALTER TABLE "service_users"."MedicationAdministrationEvent"
  ADD COLUMN IF NOT EXISTS "medicationNameSnapshot" TEXT,
  ADD COLUMN IF NOT EXISTS "doseSnapshot" TEXT,
  ADD COLUMN IF NOT EXISTS "strengthSnapshot" TEXT,
  ADD COLUMN IF NOT EXISTS "routeNameSnapshot" TEXT,
  ADD COLUMN IF NOT EXISTS "managerReviewedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "managerReviewedById" UUID,
  ADD COLUMN IF NOT EXISTS "managerReviewNotes" TEXT;

ALTER TABLE "service_users"."MedicationAdministrationEvent"
  ADD CONSTRAINT "MedicationAdministrationEvent_managerReviewedById_fkey"
  FOREIGN KEY ("managerReviewedById") REFERENCES "identity"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "MedicationAdministrationEvent_managerReviewedAt_idx"
  ON "service_users"."MedicationAdministrationEvent"("managerReviewedAt");
