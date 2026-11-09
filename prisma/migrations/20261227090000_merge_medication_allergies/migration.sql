-- One allergy list per person: copy the old Meds-tab allergies into the profile allergy list
-- (which the carer app, family portal and medicine warnings use). Rows already on the profile list
-- under the same name are skipped. The old table is left in place, unused, so nothing is lost.
INSERT INTO "service_users"."ServiceUserAllergy"
  ("id", "serviceUserId", "allergyCatalogId", "allergyName", "comment", "isActive", "createdAt", "updatedAt", "createdById", "updatedById")
SELECT
  gen_random_uuid(),
  m."serviceUserId",
  c."id",
  COALESCE(c."name", m."allergyName"),
  COALESCE(NULLIF(CONCAT_WS('. ',
    CASE WHEN NULLIF(TRIM(m."reaction"), '') IS NOT NULL THEN 'Reaction: ' || TRIM(m."reaction") END,
    CASE WHEN NULLIF(TRIM(m."severity"), '') IS NOT NULL THEN 'Severity: ' || TRIM(m."severity") END,
    NULLIF(TRIM(m."notes"), '')
  ), ''), 'Recorded from the Meds tab'),
  true,
  m."createdAt",
  NOW(),
  m."createdById",
  m."updatedById"
FROM "service_users"."MedicationAllergy" m
LEFT JOIN LATERAL (
  SELECT ac."id", ac."name" FROM "service_users"."AllergyCatalog" ac
  WHERE LOWER(ac."name") = LOWER(TRIM(m."allergyName"))
  ORDER BY ac."isActive" DESC LIMIT 1
) c ON true
WHERE m."deletedAt" IS NULL
  AND m."isActive" = true
  AND NOT EXISTS (
    SELECT 1 FROM "service_users"."ServiceUserAllergy" s
    WHERE s."serviceUserId" = m."serviceUserId"
      AND s."deletedAt" IS NULL
      AND LOWER(s."allergyName") = LOWER(TRIM(m."allergyName"))
  );
