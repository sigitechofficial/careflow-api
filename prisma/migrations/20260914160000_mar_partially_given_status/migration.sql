-- Default MAR outcome: Partially given (PG), with visit-outcome reasons.

INSERT INTO "service_users"."MedicationStatusCode"
  ("id", "code", "label", "color", "textColor", "category", "administrationStatus",
   "reasonRequirement", "managerReviewRequirement", "sortOrder", "isActive",
   "createdAt", "updatedAt")
SELECT
  gen_random_uuid(),
  'PG',
  'Partially given',
  '#EF6C00',
  '#FFFFFF',
  'EXCEPTION',
  'GIVEN',
  'REQUIRED',
  'REQUIRED',
  15,
  true,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
WHERE NOT EXISTS (
  SELECT 1 FROM "service_users"."MedicationStatusCode" WHERE "code" = 'PG'
);

INSERT INTO "scheduling"."VisitOutcomeCatalog"
  ("id", "area", "code", "label", "allowsReasons", "sortOrder", "isActive", "createdAt", "updatedAt")
SELECT
  'a1000000-0000-4000-8000-000000000016',
  'MEDICATION',
  'PG',
  'Partially given',
  true,
  15,
  true,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
WHERE NOT EXISTS (
  SELECT 1
  FROM "scheduling"."VisitOutcomeCatalog"
  WHERE "area" = 'MEDICATION' AND "code" = 'PG'
);

UPDATE "scheduling"."VisitOutcomeCatalog"
SET
  "label" = 'Partially given',
  "allowsReasons" = true,
  "sortOrder" = 15,
  "isActive" = true,
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "area" = 'MEDICATION' AND "code" = 'PG';

INSERT INTO "scheduling"."VisitOutcomeReasonCatalog"
  ("id", "outcomeId", "label", "requiresNotes", "sortOrder", "isActive", "createdAt", "updatedAt")
SELECT
  gen_random_uuid(),
  o."id",
  r."label",
  r."requiresNotes",
  r."sortOrder",
  true,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "scheduling"."VisitOutcomeCatalog" o
CROSS JOIN (
  VALUES
    ('Client spat out / did not swallow'::text, false::boolean, 10),
    ('Client vomited after dose'::text, false::boolean, 20),
    ('Only part of the dose taken'::text, false::boolean, 30),
    ('Other'::text, true::boolean, 99)
) AS r("label", "requiresNotes", "sortOrder")
WHERE o."area" = 'MEDICATION' AND o."code" = 'PG'
ON CONFLICT ("outcomeId", "label") DO NOTHING;
