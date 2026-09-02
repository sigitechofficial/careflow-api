-- Arrival reasons are label-only. Drop the hidden code column.

DROP INDEX IF EXISTS "scheduling"."VisitClockInArrivalReasonCatalog_kind_code_key";

ALTER TABLE "scheduling"."VisitClockInArrivalReasonCatalog"
  DROP COLUMN "code";

CREATE UNIQUE INDEX "VisitClockInArrivalReasonCatalog_kind_label_key"
  ON "scheduling"."VisitClockInArrivalReasonCatalog"("kind", "label");
