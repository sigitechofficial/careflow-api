-- Admin Settings outcome + reason catalogues (Medication / Task / Observation).

CREATE TYPE "scheduling"."VisitOutcomeArea" AS ENUM ('MEDICATION', 'TASK', 'OBSERVATION');

CREATE TABLE "scheduling"."VisitOutcomeCatalog" (
    "id" UUID NOT NULL,
    "area" "scheduling"."VisitOutcomeArea" NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "allowsReasons" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VisitOutcomeCatalog_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "VisitOutcomeCatalog_area_code_key"
  ON "scheduling"."VisitOutcomeCatalog"("area", "code");

CREATE INDEX "VisitOutcomeCatalog_area_isActive_idx"
  ON "scheduling"."VisitOutcomeCatalog"("area", "isActive");

CREATE INDEX "VisitOutcomeCatalog_sortOrder_idx"
  ON "scheduling"."VisitOutcomeCatalog"("sortOrder");

CREATE TABLE "scheduling"."VisitOutcomeReasonCatalog" (
    "id" UUID NOT NULL,
    "outcomeId" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "requiresNotes" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VisitOutcomeReasonCatalog_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "VisitOutcomeReasonCatalog_outcomeId_label_key"
  ON "scheduling"."VisitOutcomeReasonCatalog"("outcomeId", "label");

CREATE INDEX "VisitOutcomeReasonCatalog_outcomeId_isActive_idx"
  ON "scheduling"."VisitOutcomeReasonCatalog"("outcomeId", "isActive");

CREATE INDEX "VisitOutcomeReasonCatalog_sortOrder_idx"
  ON "scheduling"."VisitOutcomeReasonCatalog"("sortOrder");

ALTER TABLE "scheduling"."VisitOutcomeReasonCatalog"
  ADD CONSTRAINT "VisitOutcomeReasonCatalog_outcomeId_fkey"
  FOREIGN KEY ("outcomeId") REFERENCES "scheduling"."VisitOutcomeCatalog"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Medication outcomes (app pills G / R / N / U)
INSERT INTO "scheduling"."VisitOutcomeCatalog"
  ("id", "area", "code", "label", "allowsReasons", "sortOrder", "isActive", "createdAt", "updatedAt")
VALUES
  ('a1000000-0000-4000-8000-000000000001', 'MEDICATION', 'G', 'Given', false, 10, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('a1000000-0000-4000-8000-000000000002', 'MEDICATION', 'R', 'Refused', true, 20, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('a1000000-0000-4000-8000-000000000003', 'MEDICATION', 'N', 'Not given', true, 30, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('a1000000-0000-4000-8000-000000000004', 'MEDICATION', 'U', 'Unavailable', true, 40, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

-- Task outcomes (notes-only today; reasons can be added later)
INSERT INTO "scheduling"."VisitOutcomeCatalog"
  ("id", "area", "code", "label", "allowsReasons", "sortOrder", "isActive", "createdAt", "updatedAt")
VALUES
  ('a2000000-0000-4000-8000-000000000001', 'TASK', 'COMPLETED', 'Completed', false, 10, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('a2000000-0000-4000-8000-000000000002', 'TASK', 'PARTIAL', 'Partial', true, 20, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('a2000000-0000-4000-8000-000000000003', 'TASK', 'DECLINED', 'Declined', true, 30, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

-- Observation outcomes
INSERT INTO "scheduling"."VisitOutcomeCatalog"
  ("id", "area", "code", "label", "allowsReasons", "sortOrder", "isActive", "createdAt", "updatedAt")
VALUES
  ('a3000000-0000-4000-8000-000000000001', 'OBSERVATION', 'RECORDED', 'Recorded', false, 10, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('a3000000-0000-4000-8000-000000000002', 'OBSERVATION', 'UNABLE', 'Unable to obtain', true, 20, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

-- Refused reasons
INSERT INTO "scheduling"."VisitOutcomeReasonCatalog"
  ("id", "outcomeId", "label", "requiresNotes", "sortOrder", "isActive", "createdAt", "updatedAt")
VALUES
  (gen_random_uuid(), 'a1000000-0000-4000-8000-000000000002', 'Client declined medication', false, 10, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'a1000000-0000-4000-8000-000000000002', 'Client requested medication later', false, 20, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'a1000000-0000-4000-8000-000000000002', 'Client did not understand the request', false, 30, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'a1000000-0000-4000-8000-000000000002', 'Client was distressed', false, 40, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'a1000000-0000-4000-8000-000000000002', 'Other', true, 99, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

-- Not given reasons
INSERT INTO "scheduling"."VisitOutcomeReasonCatalog"
  ("id", "outcomeId", "label", "requiresNotes", "sortOrder", "isActive", "createdAt", "updatedAt")
VALUES
  (gen_random_uuid(), 'a1000000-0000-4000-8000-000000000003', 'Medication unavailable', false, 10, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'a1000000-0000-4000-8000-000000000003', 'Client unwell', false, 20, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'a1000000-0000-4000-8000-000000000003', 'Client asleep', false, 30, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'a1000000-0000-4000-8000-000000000003', 'Dose not due', false, 40, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'a1000000-0000-4000-8000-000000000003', 'Clinical concern', false, 50, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'a1000000-0000-4000-8000-000000000003', 'Unable to access medication', false, 60, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'a1000000-0000-4000-8000-000000000003', 'Other', true, 99, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

-- Unavailable reasons (same defaults as Not given; can diverge later)
INSERT INTO "scheduling"."VisitOutcomeReasonCatalog"
  ("id", "outcomeId", "label", "requiresNotes", "sortOrder", "isActive", "createdAt", "updatedAt")
VALUES
  (gen_random_uuid(), 'a1000000-0000-4000-8000-000000000004', 'Medication unavailable', false, 10, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'a1000000-0000-4000-8000-000000000004', 'Client unwell', false, 20, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'a1000000-0000-4000-8000-000000000004', 'Client asleep', false, 30, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'a1000000-0000-4000-8000-000000000004', 'Dose not due', false, 40, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'a1000000-0000-4000-8000-000000000004', 'Clinical concern', false, 50, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'a1000000-0000-4000-8000-000000000004', 'Unable to access medication', false, 60, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'a1000000-0000-4000-8000-000000000004', 'Other', true, 99, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
