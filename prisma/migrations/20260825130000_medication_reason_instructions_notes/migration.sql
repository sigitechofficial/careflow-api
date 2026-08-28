-- Split chart "reason" from giving instructions and office notes.
ALTER TABLE "service_users"."ServiceUserMedication"
  ADD COLUMN "reasonForMedication" TEXT;

-- Old "Reason for medication" lived in instructions.
UPDATE "service_users"."ServiceUserMedication"
SET "reasonForMedication" = NULLIF(TRIM("instructions"), '')
WHERE "reasonForMedication" IS NULL;

-- Old "Medication notes" were mostly how-to-give — become instructions.
-- If there were no notes, clear instructions so reason is not duplicated.
UPDATE "service_users"."ServiceUserMedication"
SET "instructions" = NULLIF(TRIM("notes"), '');

-- Office notes start empty after the split.
UPDATE "service_users"."ServiceUserMedication"
SET "notes" = NULL
WHERE "notes" IS NOT NULL;
