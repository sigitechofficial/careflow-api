-- Visit tasks attach to visits by clock time (like scheduled medicines), not by round code.
ALTER TABLE "service_users"."ServiceUserVisitTaskAssignment"
  ADD COLUMN IF NOT EXISTS "dueTime" VARCHAR(5);

-- Backfill so no existing task disappears: use the start of the service user's own
-- active visit-plan slot for that round (earliest if several), else the round's time.
UPDATE "service_users"."ServiceUserVisitTaskAssignment" a
SET "dueTime" = COALESCE(
  (
    SELECT s."plannedStartTime"
    FROM "service_users"."VisitPlanSlot" s
    JOIN "service_users"."ServiceUserVisitPlan" p ON p."id" = s."visitPlanId"
    WHERE p."serviceUserId" = a."serviceUserId"
      AND p."status" = 'ACTIVE'
      AND p."deletedAt" IS NULL
      AND UPPER(COALESCE(s."medicationRoundCode", s."slotCode")) = UPPER(a."medicationRoundCode")
    ORDER BY s."plannedStartTime" ASC
    LIMIT 1
  ),
  (
    SELECT r."time"
    FROM "service_users"."MedicationAdministrationRound" r
    WHERE UPPER(r."code") = UPPER(a."medicationRoundCode")
    LIMIT 1
  )
)
WHERE a."dueTime" IS NULL;
