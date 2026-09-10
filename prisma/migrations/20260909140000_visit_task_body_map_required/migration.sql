-- Per-assignment flag: carer must add a body-map mark before this task can complete.
ALTER TABLE "service_users"."ServiceUserVisitTaskAssignment"
ADD COLUMN IF NOT EXISTS "bodyMapRequired" BOOLEAN NOT NULL DEFAULT false;

-- Existing catalogue tasks that feed the body map stay required (e.g. Wound care).
UPDATE "service_users"."ServiceUserVisitTaskAssignment" AS a
SET "bodyMapRequired" = true
FROM "service_users"."TaskCatalogueTask" AS t
WHERE a."taskCatalogueTaskId" = t.id
  AND t."flagsJson" IS NOT NULL
  AND t."flagsJson"->'feedsObservation' @> '"body_map"'::jsonb;
