-- Phase 0: nullable semantic field keys for CarePathwayFormField (no backfill, no valuesJson changes).
-- Idempotent: this migration may reach an environment where the column/index was already
-- applied manually (live-DB apply), so guard with IF NOT EXISTS to keep `migrate deploy` safe.

ALTER TABLE "care_pathway"."CarePathwayFormField"
ADD COLUMN IF NOT EXISTS "fieldKey" VARCHAR(128);

CREATE INDEX IF NOT EXISTS "CarePathwayFormField_fieldKey_idx"
ON "care_pathway"."CarePathwayFormField"("fieldKey");
