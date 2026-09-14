-- Office reasons when allowing a carer to continue after leaving the visit area.
-- Managed in admin Settings → Left-area allow reasons.

CREATE TABLE "scheduling"."VisitLeftAreaAllowReasonCatalog" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "requiresNotes" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VisitLeftAreaAllowReasonCatalog_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "VisitLeftAreaAllowReasonCatalog_code_key"
  ON "scheduling"."VisitLeftAreaAllowReasonCatalog"("code");

CREATE UNIQUE INDEX "VisitLeftAreaAllowReasonCatalog_label_key"
  ON "scheduling"."VisitLeftAreaAllowReasonCatalog"("label");

CREATE INDEX "VisitLeftAreaAllowReasonCatalog_isActive_idx"
  ON "scheduling"."VisitLeftAreaAllowReasonCatalog"("isActive");

CREATE INDEX "VisitLeftAreaAllowReasonCatalog_sortOrder_idx"
  ON "scheduling"."VisitLeftAreaAllowReasonCatalog"("sortOrder");

INSERT INTO "scheduling"."VisitLeftAreaAllowReasonCatalog"
  ("id", "code", "label", "requiresNotes", "sortOrder", "isActive", "createdAt", "updatedAt")
VALUES
  (gen_random_uuid(), 'ACCOMPANY_GP', 'Accompanying to GP / appointment', false, 10, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'PHARMACY', 'Pharmacy / collecting medication', false, 20, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'OUTING_WITH_PERSON', 'Shopping or outing with the person', false, 30, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'WAITING_IN_CAR', 'Waiting in the car / parking', false, 40, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'HOSPITAL_ESCORT', 'Hospital or emergency escort', false, 50, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'GPS_INACCURATE', 'Still with the person, GPS inaccurate', false, 60, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'OTHER', 'Other reason', true, 99, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

ALTER TABLE "scheduling"."VisitAreaLock"
  ADD COLUMN "allowReasonId" UUID;

ALTER TABLE "scheduling"."VisitAreaLock"
  ADD CONSTRAINT "VisitAreaLock_allowReasonId_fkey"
  FOREIGN KEY ("allowReasonId") REFERENCES "scheduling"."VisitLeftAreaAllowReasonCatalog"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
