-- First-class date of death for Service User list range filters.
-- Synced from profile reference SU_PROFILE_DATE_OF_DEATH when that ref is saved.

ALTER TABLE "service_users"."ServiceUser"
  ADD COLUMN IF NOT EXISTS "dateOfDeath" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "ServiceUser_dateOfDeath_idx"
  ON "service_users"."ServiceUser"("dateOfDeath");

-- Best-effort backfill from existing profile refs (YYYY-MM-DD or ISO prefix).
UPDATE "service_users"."ServiceUser" AS su
SET "dateOfDeath" = sub.parsed
FROM (
  SELECT DISTINCT ON (r."serviceUserId")
    r."serviceUserId",
    CASE
      WHEN trim(r."referenceValue") ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}'
        THEN (substring(trim(r."referenceValue") from 1 for 10)::date + TIME '12:00')::timestamp
      ELSE NULL
    END AS parsed
  FROM "service_users"."ServiceUserReference" r
  WHERE r."referenceType" = 'SU_PROFILE_DATE_OF_DEATH'
    AND r."deletedAt" IS NULL
    AND coalesce(trim(r."referenceValue"), '') <> ''
  ORDER BY r."serviceUserId", r."updatedAt" DESC
) AS sub
WHERE su.id = sub."serviceUserId"
  AND su."dateOfDeath" IS NULL
  AND sub.parsed IS NOT NULL;
