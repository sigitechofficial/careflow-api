-- Investigations now start (record created) when the incident goes Under Investigation.
-- Backfill incidents already Under Investigation without a record: start = when they last moved there.
INSERT INTO "incidents"."IncidentInvestigation"
  ("id", "incidentId", "contributingFactors", "investigationStatus", "createdAt", "updatedAt", "createdById", "updatedById")
SELECT
  gen_random_uuid(),
  i."id",
  ARRAY[]::TEXT[],
  'IN_PROGRESS',
  COALESCE(h."createdAt", i."updatedAt"),
  COALESCE(h."createdAt", i."updatedAt"),
  h."changedById",
  h."changedById"
FROM "incidents"."Incident" i
LEFT JOIN LATERAL (
  SELECT sh."createdAt", sh."changedById"
  FROM "incidents"."IncidentStatusHistory" sh
  WHERE sh."incidentId" = i."id" AND sh."toStatus" = 'UNDER_INVESTIGATION'
  ORDER BY sh."createdAt" DESC
  LIMIT 1
) h ON TRUE
WHERE i."status" = 'UNDER_INVESTIGATION'
  AND i."deletedAt" IS NULL
  AND NOT EXISTS (SELECT 1 FROM "incidents"."IncidentInvestigation" x WHERE x."incidentId" = i."id");
