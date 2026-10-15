-- Time slots (Settings → Medication time slots, also the rota board day bands):
-- Morning 07:00–11:00 so it meets Midday at 11:00 (no "No time slot" gap 10:00–11:00),
-- Night 20:00–07:00 so overnight visits and night doses fall inside the Night slot.
-- Only rows still on the old defaults (20260606120000_medication_round_windows) are changed;
-- a window an organisation has already set itself is left as it is.

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
