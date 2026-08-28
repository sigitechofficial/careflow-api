-- Phase 0: nullable semantic field keys for CarePathwayFormField (no backfill, no valuesJson changes).

ALTER TABLE "care_pathway"."CarePathwayFormField"
ADD COLUMN "fieldKey" VARCHAR(128);

CREATE INDEX "CarePathwayFormField_fieldKey_idx"
ON "care_pathway"."CarePathwayFormField"("fieldKey");
