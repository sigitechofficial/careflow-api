-- Re-apply 20261015120000_time_slot_morning_night_windows.
-- That migration ran on live, but the deploy seed then wrote the old defaults back
-- (Morning 07:00–10:00, Night 20:00–23:59). The seed no longer updates existing slots.
-- Only rows still on the old defaults are changed; a window an organisation set itself is left as it is.
UPDATE "service_users"."MedicationAdministrationRound"
SET "windowEnd" = '11:00',
    "updatedAt" = NOW()
WHERE "code" = 'MORNING'
  AND "deletedAt" IS NULL
  AND "windowStart" = '07:00'
  AND "windowEnd" = '10:00';

UPDATE "service_users"."MedicationAdministrationRound"
SET "windowEnd" = '07:00',
    "updatedAt" = NOW()
WHERE "code" = 'NIGHT'
  AND "deletedAt" IS NULL
  AND "windowStart" = '20:00'
  AND "windowEnd" = '23:59';
