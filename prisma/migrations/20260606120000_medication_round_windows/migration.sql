-- Spec §5: default time + administration window per round
ALTER TABLE "service_users"."MedicationAdministrationRound"
  ADD COLUMN IF NOT EXISTS "windowStart" VARCHAR(5),
  ADD COLUMN IF NOT EXISTS "windowEnd" VARCHAR(5);

UPDATE "service_users"."MedicationAdministrationRound"
SET
  "windowStart" = COALESCE("windowStart", '07:00'),
  "windowEnd" = COALESCE("windowEnd", '10:00')
WHERE "code" = 'MORNING';

UPDATE "service_users"."MedicationAdministrationRound"
SET
  "windowStart" = COALESCE("windowStart", '11:00'),
  "windowEnd" = COALESCE("windowEnd", '14:00')
WHERE "code" = 'MIDDAY';

UPDATE "service_users"."MedicationAdministrationRound"
SET
  "windowStart" = COALESCE("windowStart", '14:00'),
  "windowEnd" = COALESCE("windowEnd", '17:00')
WHERE "code" = 'AFTERNOON';

UPDATE "service_users"."MedicationAdministrationRound"
SET
  "windowStart" = COALESCE("windowStart", '17:00'),
  "windowEnd" = COALESCE("windowEnd", '20:00')
WHERE "code" = 'EVENING';

UPDATE "service_users"."MedicationAdministrationRound"
SET
  "windowStart" = COALESCE("windowStart", '20:00'),
  "windowEnd" = COALESCE("windowEnd", '23:59')
WHERE "code" = 'NIGHT';

-- Legacy seed codes: map to spec windows by approximate slot
UPDATE "service_users"."MedicationAdministrationRound"
SET
  "name" = 'Morning',
  "code" = 'MORNING',
  "time" = '08:00',
  "windowStart" = '07:00',
  "windowEnd" = '10:00',
  "sortOrder" = 1
WHERE "code" = 'BREAKFAST_ROUND';

UPDATE "service_users"."MedicationAdministrationRound"
SET
  "name" = 'Midday',
  "code" = 'MIDDAY',
  "time" = '12:00',
  "windowStart" = '11:00',
  "windowEnd" = '14:00',
  "sortOrder" = 2
WHERE "code" = 'LUNCH_ROUND';

UPDATE "service_users"."MedicationAdministrationRound"
SET
  "name" = 'Afternoon',
  "code" = 'AFTERNOON',
  "time" = '15:00',
  "windowStart" = '14:00',
  "windowEnd" = '17:00',
  "sortOrder" = 3
WHERE "code" = 'TEA_ROUND';

UPDATE "service_users"."MedicationAdministrationRound"
SET
  "name" = 'Evening',
  "code" = 'EVENING',
  "time" = '18:00',
  "windowStart" = '17:00',
  "windowEnd" = '20:00',
  "sortOrder" = 4
WHERE "code" = 'BED_ROUND';
