-- Blister pack wizard setup fields (cycle, prescription check, admin rules)
ALTER TABLE "service_users"."MedicationPack"
    ADD COLUMN IF NOT EXISTS "cycleDurationDays" INTEGER,
    ADD COLUMN IF NOT EXISTS "reviewDate" TIMESTAMP(3),
    ADD COLUMN IF NOT EXISTS "prescriptionChecked" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS "prescriptionCheckedBy" TEXT,
    ADD COLUMN IF NOT EXISTS "prescriptionCheckedAt" TIMESTAMP(3),
    ADD COLUMN IF NOT EXISTS "generateAheadDays" INTEGER,
    ADD COLUMN IF NOT EXISTS "adminRules" JSONB;
