-- Office reasons when authorising Manual check-in for a carer outside the visit area.
-- Managed in admin Settings → Manual authorisation reasons.

CREATE TABLE "scheduling"."VisitManualAuthorisationReasonCatalog" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "requiresNotes" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VisitManualAuthorisationReasonCatalog_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "VisitManualAuthorisationReasonCatalog_code_key"
  ON "scheduling"."VisitManualAuthorisationReasonCatalog"("code");

CREATE UNIQUE INDEX "VisitManualAuthorisationReasonCatalog_label_key"
  ON "scheduling"."VisitManualAuthorisationReasonCatalog"("label");

CREATE INDEX "VisitManualAuthorisationReasonCatalog_isActive_idx"
  ON "scheduling"."VisitManualAuthorisationReasonCatalog"("isActive");

CREATE INDEX "VisitManualAuthorisationReasonCatalog_sortOrder_idx"
  ON "scheduling"."VisitManualAuthorisationReasonCatalog"("sortOrder");

INSERT INTO "scheduling"."VisitManualAuthorisationReasonCatalog"
  ("id", "code", "label", "requiresNotes", "sortOrder", "isActive", "createdAt", "updatedAt")
VALUES
  (gen_random_uuid(), 'GPS_NOT_WORKING', 'GPS not working', false, 10, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'GEO_PIN_INCORRECT', 'Visit address or geofence is incorrect', false, 20, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'AT_PROPERTY_OUTSIDE_RADIUS', 'Carer is at the property', false, 30, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'PARKING_OR_ACCESS', 'Parking or access delay', false, 40, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'SERVICE_USER_ELSEWHERE', 'Service user not at usual address', false, 50, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'DEVICE_LOCATION_ISSUE', 'Device or app location issue', false, 60, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'OTHER', 'Other reason', true, 99, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

ALTER TABLE "scheduling"."VisitCheckInMethodGrant"
  ADD COLUMN "officeReasonId" UUID;

ALTER TABLE "scheduling"."VisitCheckInMethodGrant"
  ADD CONSTRAINT "VisitCheckInMethodGrant_officeReasonId_fkey"
  FOREIGN KEY ("officeReasonId") REFERENCES "scheduling"."VisitManualAuthorisationReasonCatalog"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
