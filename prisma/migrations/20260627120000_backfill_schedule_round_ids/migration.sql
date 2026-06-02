-- Link existing medication schedules to administration rounds by due time (MAR calendar labels).
UPDATE "service_users"."MedicationSchedule" AS s
SET "roundId" = r.id
FROM "service_users"."MedicationAdministrationRound" AS r
WHERE s."roundId" IS NULL
  AND s."dueTime" IS NOT NULL
  AND s."deletedAt" IS NULL
  AND r."deletedAt" IS NULL
  AND r."isActive" = true
  AND s."dueTime" = LEFT(r."time", 5);
