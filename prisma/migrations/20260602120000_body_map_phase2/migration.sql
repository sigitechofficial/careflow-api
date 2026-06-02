-- Body map Phase 2: wound/pressure assessments, links, audit actions

CREATE TYPE "service_users"."BodyMapLinkedModule" AS ENUM (
  'CARE_PLAN',
  'MAR',
  'INCIDENT',
  'RISK_ASSESSMENT',
  'REFERRAL',
  'CARE_NOTE'
);

ALTER TYPE "service_users"."BodyMapAuditAction" ADD VALUE IF NOT EXISTS 'ADD_LINK';
ALTER TYPE "service_users"."BodyMapAuditAction" ADD VALUE IF NOT EXISTS 'WOUND_ASSESSMENT';
ALTER TYPE "service_users"."BodyMapAuditAction" ADD VALUE IF NOT EXISTS 'PRESSURE_ASSESSMENT';

CREATE TABLE "service_users"."BodyMapWoundAssessment" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "bodyMapRecordId" UUID NOT NULL,
  "woundType" TEXT,
  "exudate" TEXT,
  "dressing" TEXT,
  "nextDressingChange" TIMESTAMP(3),
  "measurements" TEXT,
  "infectionSigns" TEXT,
  "professionalInvolvement" TEXT,
  "assessmentData" JSONB,
  "createdById" UUID,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "BodyMapWoundAssessment_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "BodyMapWoundAssessment_bodyMapRecordId_key" UNIQUE ("bodyMapRecordId"),
  CONSTRAINT "BodyMapWoundAssessment_bodyMapRecordId_fkey" FOREIGN KEY ("bodyMapRecordId") REFERENCES "service_users"."BodyMapRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "BodyMapWoundAssessment_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "identity"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "service_users"."BodyMapPressureAssessment" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "bodyMapRecordId" UUID NOT NULL,
  "riskTool" TEXT,
  "blanching" TEXT,
  "skinIntact" TEXT,
  "repositioningRecorded" TEXT,
  "nonBlanching" TEXT,
  "repositioningFrequency" TEXT,
  "pressureEquipment" TEXT,
  "assessmentData" JSONB,
  "createdById" UUID,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "BodyMapPressureAssessment_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "BodyMapPressureAssessment_bodyMapRecordId_key" UNIQUE ("bodyMapRecordId"),
  CONSTRAINT "BodyMapPressureAssessment_bodyMapRecordId_fkey" FOREIGN KEY ("bodyMapRecordId") REFERENCES "service_users"."BodyMapRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "BodyMapPressureAssessment_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "identity"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "service_users"."BodyMapLink" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "bodyMapRecordId" UUID NOT NULL,
  "linkedModule" "service_users"."BodyMapLinkedModule" NOT NULL,
  "linkedRecordId" UUID NOT NULL,
  "label" TEXT,
  "createdById" UUID,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "BodyMapLink_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "BodyMapLink_bodyMapRecordId_fkey" FOREIGN KEY ("bodyMapRecordId") REFERENCES "service_users"."BodyMapRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "BodyMapLink_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "identity"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "BodyMapLink_bodyMapRecordId_idx" ON "service_users"."BodyMapLink"("bodyMapRecordId");
CREATE INDEX "BodyMapLink_linkedModule_linkedRecordId_idx" ON "service_users"."BodyMapLink"("linkedModule", "linkedRecordId");
