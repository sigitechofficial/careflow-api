-- Body map: records, markers, reviews, audit trail

CREATE TYPE "service_users"."BodyMapRecordType" AS ENUM (
  'INJURY',
  'WOUND',
  'PRESSURE',
  'MEDICATION',
  'PAIN',
  'SKIN',
  'DEVICE',
  'SAFEGUARDING'
);

CREATE TYPE "service_users"."BodyMapRecordStatus" AS ENUM (
  'ACTIVE',
  'REVIEW_DUE',
  'MONITORING',
  'RESOLVED',
  'CLOSED',
  'AWAITING_REVIEW'
);

CREATE TYPE "service_users"."BodyMapRiskLevel" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'URGENT');

CREATE TYPE "service_users"."BodyMapBodyView" AS ENUM (
  'FRONT',
  'BACK',
  'LEFT',
  'RIGHT',
  'FACE',
  'HAND',
  'FOOT'
);

CREATE TYPE "service_users"."BodyMapSide" AS ENUM ('LEFT', 'RIGHT', 'CENTRE');

CREATE TYPE "service_users"."BodyMapConditionStatus" AS ENUM (
  'IMPROVING',
  'UNCHANGED',
  'WORSENING',
  'RESOLVED'
);

CREATE TYPE "service_users"."BodyMapAuditAction" AS ENUM (
  'CREATE',
  'UPDATE',
  'CLOSE',
  'ADD_MARKER',
  'UPDATE_MARKER',
  'ADD_REVIEW'
);

CREATE TABLE "service_users"."BodyMapRecord" (
  "id" UUID NOT NULL,
  "serviceUserId" UUID NOT NULL,
  "recordType" "service_users"."BodyMapRecordType" NOT NULL,
  "subType" TEXT,
  "title" TEXT,
  "description" TEXT,
  "riskLevel" "service_users"."BodyMapRiskLevel" NOT NULL DEFAULT 'MEDIUM',
  "status" "service_users"."BodyMapRecordStatus" NOT NULL DEFAULT 'ACTIVE',
  "firstNoticedAt" TIMESTAMP(3),
  "noticedByType" TEXT,
  "noticedByName" TEXT,
  "causeSummary" TEXT,
  "actionSummary" TEXT,
  "observationDetails" JSONB,
  "reviewRequired" BOOLEAN NOT NULL DEFAULT true,
  "nextReviewAt" TIMESTAMP(3),
  "safeguardingTriggered" BOOLEAN NOT NULL DEFAULT false,
  "managerReviewRequired" BOOLEAN NOT NULL DEFAULT false,
  "closedAt" TIMESTAMP(3),
  "closedById" UUID,
  "closureNote" TEXT,
  "isArchived" BOOLEAN NOT NULL DEFAULT false,
  "createdById" UUID,
  "updatedById" UUID,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "BodyMapRecord_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "service_users"."BodyMapMarker" (
  "id" UUID NOT NULL,
  "bodyMapRecordId" UUID NOT NULL,
  "bodyView" "service_users"."BodyMapBodyView" NOT NULL,
  "side" "service_users"."BodyMapSide",
  "bodyPart" TEXT NOT NULL,
  "specificLocation" TEXT,
  "xCoordinate" DECIMAL(8, 5) NOT NULL,
  "yCoordinate" DECIMAL(8, 5) NOT NULL,
  "markerNumber" INTEGER NOT NULL,
  "markerType" "service_users"."BodyMapRecordType" NOT NULL,
  "riskLevel" "service_users"."BodyMapRiskLevel" NOT NULL,
  "status" "service_users"."BodyMapRecordStatus" NOT NULL,
  "isVisible" BOOLEAN NOT NULL DEFAULT true,
  "createdById" UUID,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "BodyMapMarker_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "service_users"."BodyMapReview" (
  "id" UUID NOT NULL,
  "bodyMapRecordId" UUID NOT NULL,
  "reviewedById" UUID,
  "reviewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "conditionStatus" "service_users"."BodyMapConditionStatus" NOT NULL,
  "reviewNote" TEXT,
  "actionTaken" TEXT,
  "escalationRequired" BOOLEAN NOT NULL DEFAULT false,
  "nextReviewAt" TIMESTAMP(3),
  "signature" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "BodyMapReview_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "service_users"."BodyMapAuditLog" (
  "id" UUID NOT NULL,
  "bodyMapRecordId" UUID NOT NULL,
  "action" "service_users"."BodyMapAuditAction" NOT NULL,
  "actorUserId" UUID,
  "payload" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "BodyMapAuditLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "BodyMapRecord_serviceUserId_idx" ON "service_users"."BodyMapRecord"("serviceUserId");
CREATE INDEX "BodyMapRecord_status_idx" ON "service_users"."BodyMapRecord"("status");
CREATE INDEX "BodyMapRecord_recordType_idx" ON "service_users"."BodyMapRecord"("recordType");
CREATE INDEX "BodyMapRecord_nextReviewAt_idx" ON "service_users"."BodyMapRecord"("nextReviewAt");
CREATE INDEX "BodyMapRecord_createdAt_idx" ON "service_users"."BodyMapRecord"("createdAt");

CREATE INDEX "BodyMapMarker_bodyMapRecordId_idx" ON "service_users"."BodyMapMarker"("bodyMapRecordId");
CREATE INDEX "BodyMapMarker_bodyView_idx" ON "service_users"."BodyMapMarker"("bodyView");

CREATE INDEX "BodyMapReview_bodyMapRecordId_idx" ON "service_users"."BodyMapReview"("bodyMapRecordId");
CREATE INDEX "BodyMapReview_reviewedAt_idx" ON "service_users"."BodyMapReview"("reviewedAt");

CREATE INDEX "BodyMapAuditLog_bodyMapRecordId_idx" ON "service_users"."BodyMapAuditLog"("bodyMapRecordId");
CREATE INDEX "BodyMapAuditLog_createdAt_idx" ON "service_users"."BodyMapAuditLog"("createdAt");

ALTER TABLE "service_users"."BodyMapRecord"
  ADD CONSTRAINT "BodyMapRecord_serviceUserId_fkey"
  FOREIGN KEY ("serviceUserId") REFERENCES "service_users"."ServiceUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "service_users"."BodyMapRecord"
  ADD CONSTRAINT "BodyMapRecord_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "identity"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "service_users"."BodyMapRecord"
  ADD CONSTRAINT "BodyMapRecord_updatedById_fkey"
  FOREIGN KEY ("updatedById") REFERENCES "identity"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "service_users"."BodyMapRecord"
  ADD CONSTRAINT "BodyMapRecord_closedById_fkey"
  FOREIGN KEY ("closedById") REFERENCES "identity"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "service_users"."BodyMapMarker"
  ADD CONSTRAINT "BodyMapMarker_bodyMapRecordId_fkey"
  FOREIGN KEY ("bodyMapRecordId") REFERENCES "service_users"."BodyMapRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "service_users"."BodyMapMarker"
  ADD CONSTRAINT "BodyMapMarker_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "identity"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "service_users"."BodyMapReview"
  ADD CONSTRAINT "BodyMapReview_bodyMapRecordId_fkey"
  FOREIGN KEY ("bodyMapRecordId") REFERENCES "service_users"."BodyMapRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "service_users"."BodyMapReview"
  ADD CONSTRAINT "BodyMapReview_reviewedById_fkey"
  FOREIGN KEY ("reviewedById") REFERENCES "identity"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "service_users"."BodyMapAuditLog"
  ADD CONSTRAINT "BodyMapAuditLog_bodyMapRecordId_fkey"
  FOREIGN KEY ("bodyMapRecordId") REFERENCES "service_users"."BodyMapRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "service_users"."BodyMapAuditLog"
  ADD CONSTRAINT "BodyMapAuditLog_actorUserId_fkey"
  FOREIGN KEY ("actorUserId") REFERENCES "identity"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
