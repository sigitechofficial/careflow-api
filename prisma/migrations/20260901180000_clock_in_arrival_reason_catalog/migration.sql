-- Org-configurable early / late clock-in arrival reasons (admin Settings).
-- Seeded with the previous hardcoded employee-app catalogues so existing
-- check-ins keep the same codes after the app stops using local fallbacks.

CREATE TYPE "scheduling"."VisitClockInArrivalKind" AS ENUM ('EARLY', 'LATE');

CREATE TABLE "scheduling"."VisitClockInArrivalReasonCatalog" (
    "id" UUID NOT NULL,
    "kind" "scheduling"."VisitClockInArrivalKind" NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "requiresNotes" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VisitClockInArrivalReasonCatalog_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "VisitClockInArrivalReasonCatalog_kind_code_key"
  ON "scheduling"."VisitClockInArrivalReasonCatalog"("kind", "code");

CREATE INDEX "VisitClockInArrivalReasonCatalog_kind_isActive_idx"
  ON "scheduling"."VisitClockInArrivalReasonCatalog"("kind", "isActive");

CREATE INDEX "VisitClockInArrivalReasonCatalog_sortOrder_idx"
  ON "scheduling"."VisitClockInArrivalReasonCatalog"("sortOrder");

INSERT INTO "scheduling"."VisitClockInArrivalReasonCatalog"
  ("id", "kind", "code", "label", "requiresNotes", "sortOrder", "isActive", "createdAt", "updatedAt")
VALUES
  (gen_random_uuid(), 'EARLY', 'CLIENT_REQUESTED_EARLIER', 'Client requested earlier arrival', false, 10, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'EARLY', 'SCHEDULING_CHANGE', 'Scheduling change', false, 20, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'EARLY', 'EMERGENCY', 'Emergency', false, 30, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'EARLY', 'OTHER', 'Other', true, 99, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'LATE', 'PREVIOUS_VISIT_OVERRAN', 'Previous visit overran', false, 10, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'LATE', 'TRAVEL_OR_TRAFFIC', 'Traffic or travel delay', false, 20, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'LATE', 'EMERGENCY', 'Emergency', false, 30, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'LATE', 'SCHEDULING_CHANGE', 'Scheduling change', false, 40, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'LATE', 'OTHER', 'Other', true, 99, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
