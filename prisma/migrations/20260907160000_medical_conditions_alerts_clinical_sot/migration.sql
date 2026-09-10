-- Medical Conditions & Alerts clinical SoTs (Phase 2).
-- Additive only: catalogue, SU medical condition, reasonable adjustments,
-- medical history events, monitoring config, usual parameters, and
-- service_users.medical_* permission catalogue rows.
-- Does NOT modify alerts.Alert or create operational alert generators.
-- Does NOT scrape/migrate IA or Care Plan free-text into these tables.

-- CreateEnum
CREATE TYPE "service_users"."MedicalConditionCategory" AS ENUM (
  'MENTAL_HEALTH',
  'NEUROLOGICAL',
  'CARDIOVASCULAR',
  'RESPIRATORY',
  'ENDOCRINE_METABOLIC',
  'LEARNING_DISABILITY',
  'DEVELOPMENTAL',
  'PALLIATIVE',
  'OTHER'
);

-- CreateEnum
CREATE TYPE "service_users"."ServiceUserMedicalConditionStatus" AS ENUM (
  'ACTIVE',
  'INACTIVE',
  'DISCONTINUED'
);

-- CreateEnum
CREATE TYPE "service_users"."ReasonableAdjustmentType" AS ENUM (
  'COMMUNICATION',
  'PHYSICAL_ACCESS',
  'SENSORY',
  'COGNITIVE',
  'CULTURAL_RELIGIOUS',
  'EQUIPMENT',
  'ROUTINE_TIMING',
  'OTHER'
);

-- CreateEnum
CREATE TYPE "service_users"."ServiceUserClinicalDataSource" AS ENUM (
  'MANUAL',
  'INITIAL_ASSESSMENT',
  'CARE_PLAN',
  'DOCUMENTS',
  'PROFILE',
  'IMPORT',
  'OTHER'
);

-- CreateTable
CREATE TABLE "service_users"."MedicalConditionCatalog" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" "service_users"."MedicalConditionCategory" NOT NULL DEFAULT 'OTHER',
    "description" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MedicalConditionCatalog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_users"."ServiceUserMedicalCondition" (
    "id" UUID NOT NULL,
    "serviceUserId" UUID NOT NULL,
    "conditionId" UUID NOT NULL,
    "status" "service_users"."ServiceUserMedicalConditionStatus" NOT NULL DEFAULT 'ACTIVE',
    "notes" TEXT NOT NULL DEFAULT '',
    "onsetDate" TIMESTAMP(3),
    "reviewDate" TIMESTAMP(3),
    "source" "service_users"."ServiceUserClinicalDataSource" NOT NULL DEFAULT 'MANUAL',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdById" UUID,
    "updatedById" UUID,
    "deletedById" UUID,

    CONSTRAINT "ServiceUserMedicalCondition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_users"."ServiceUserReasonableAdjustment" (
    "id" UUID NOT NULL,
    "serviceUserId" UUID NOT NULL,
    "type" "service_users"."ReasonableAdjustmentType" NOT NULL DEFAULT 'OTHER',
    "description" TEXT NOT NULL,
    "notes" TEXT NOT NULL DEFAULT '',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "source" "service_users"."ServiceUserClinicalDataSource" NOT NULL DEFAULT 'MANUAL',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdById" UUID,
    "updatedById" UUID,
    "deletedById" UUID,

    CONSTRAINT "ServiceUserReasonableAdjustment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_users"."ServiceUserMedicalHistoryEvent" (
    "id" UUID NOT NULL,
    "serviceUserId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "eventDate" TIMESTAMP(3),
    "approximateDate" TEXT,
    "description" TEXT NOT NULL DEFAULT '',
    "notes" TEXT NOT NULL DEFAULT '',
    "source" "service_users"."ServiceUserClinicalDataSource" NOT NULL DEFAULT 'MANUAL',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdById" UUID,
    "updatedById" UUID,
    "deletedById" UUID,

    CONSTRAINT "ServiceUserMedicalHistoryEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_users"."ServiceUserMonitoringConfig" (
    "id" UUID NOT NULL,
    "serviceUserId" UUID NOT NULL,
    "configKey" TEXT NOT NULL,
    "observationTypeId" UUID,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "numericValue" DECIMAL(12,4),
    "booleanValue" BOOLEAN,
    "textValue" TEXT,
    "notes" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" UUID,
    "updatedById" UUID,

    CONSTRAINT "ServiceUserMonitoringConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_users"."ServiceUserUsualParameter" (
    "id" UUID NOT NULL,
    "serviceUserId" UUID NOT NULL,
    "observationTypeId" UUID NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "usualNumericValue" DECIMAL(12,4),
    "usualTextValue" TEXT,
    "usualPayload" JSONB,
    "lowerBand" DECIMAL(12,4),
    "upperBand" DECIMAL(12,4),
    "notes" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" UUID,
    "updatedById" UUID,

    CONSTRAINT "ServiceUserUsualParameter_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MedicalConditionCatalog_code_key" ON "service_users"."MedicalConditionCatalog"("code");

-- CreateIndex
CREATE INDEX "MedicalConditionCatalog_isActive_idx" ON "service_users"."MedicalConditionCatalog"("isActive");

-- CreateIndex
CREATE INDEX "MedicalConditionCatalog_category_idx" ON "service_users"."MedicalConditionCatalog"("category");

-- CreateIndex
CREATE INDEX "MedicalConditionCatalog_sortOrder_idx" ON "service_users"."MedicalConditionCatalog"("sortOrder");

-- CreateIndex
CREATE INDEX "ServiceUserMedicalCondition_serviceUserId_idx" ON "service_users"."ServiceUserMedicalCondition"("serviceUserId");

-- CreateIndex
CREATE INDEX "ServiceUserMedicalCondition_conditionId_idx" ON "service_users"."ServiceUserMedicalCondition"("conditionId");

-- CreateIndex
CREATE INDEX "ServiceUserMedicalCondition_status_idx" ON "service_users"."ServiceUserMedicalCondition"("status");

-- CreateIndex
CREATE INDEX "ServiceUserMedicalCondition_deletedAt_idx" ON "service_users"."ServiceUserMedicalCondition"("deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceUserMedicalCondition_serviceUserId_conditionId_key" ON "service_users"."ServiceUserMedicalCondition"("serviceUserId", "conditionId");

-- CreateIndex
CREATE INDEX "ServiceUserReasonableAdjustment_serviceUserId_idx" ON "service_users"."ServiceUserReasonableAdjustment"("serviceUserId");

-- CreateIndex
CREATE INDEX "ServiceUserReasonableAdjustment_type_idx" ON "service_users"."ServiceUserReasonableAdjustment"("type");

-- CreateIndex
CREATE INDEX "ServiceUserReasonableAdjustment_isActive_idx" ON "service_users"."ServiceUserReasonableAdjustment"("isActive");

-- CreateIndex
CREATE INDEX "ServiceUserReasonableAdjustment_deletedAt_idx" ON "service_users"."ServiceUserReasonableAdjustment"("deletedAt");

-- CreateIndex
CREATE INDEX "ServiceUserMedicalHistoryEvent_serviceUserId_idx" ON "service_users"."ServiceUserMedicalHistoryEvent"("serviceUserId");

-- CreateIndex
CREATE INDEX "ServiceUserMedicalHistoryEvent_eventDate_idx" ON "service_users"."ServiceUserMedicalHistoryEvent"("eventDate");

-- CreateIndex
CREATE INDEX "ServiceUserMedicalHistoryEvent_deletedAt_idx" ON "service_users"."ServiceUserMedicalHistoryEvent"("deletedAt");

-- CreateIndex
CREATE INDEX "ServiceUserMonitoringConfig_serviceUserId_idx" ON "service_users"."ServiceUserMonitoringConfig"("serviceUserId");

-- CreateIndex
CREATE INDEX "ServiceUserMonitoringConfig_observationTypeId_idx" ON "service_users"."ServiceUserMonitoringConfig"("observationTypeId");

-- CreateIndex
CREATE INDEX "ServiceUserMonitoringConfig_configKey_idx" ON "service_users"."ServiceUserMonitoringConfig"("configKey");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceUserMonitoringConfig_serviceUserId_configKey_key" ON "service_users"."ServiceUserMonitoringConfig"("serviceUserId", "configKey");

-- CreateIndex
CREATE INDEX "ServiceUserUsualParameter_serviceUserId_idx" ON "service_users"."ServiceUserUsualParameter"("serviceUserId");

-- CreateIndex
CREATE INDEX "ServiceUserUsualParameter_observationTypeId_idx" ON "service_users"."ServiceUserUsualParameter"("observationTypeId");

-- CreateIndex
CREATE INDEX "ServiceUserUsualParameter_enabled_idx" ON "service_users"."ServiceUserUsualParameter"("enabled");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceUserUsualParameter_serviceUserId_observationTypeId_key" ON "service_users"."ServiceUserUsualParameter"("serviceUserId", "observationTypeId");

-- AddForeignKey
ALTER TABLE "service_users"."ServiceUserMedicalCondition" ADD CONSTRAINT "ServiceUserMedicalCondition_serviceUserId_fkey" FOREIGN KEY ("serviceUserId") REFERENCES "service_users"."ServiceUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_users"."ServiceUserMedicalCondition" ADD CONSTRAINT "ServiceUserMedicalCondition_conditionId_fkey" FOREIGN KEY ("conditionId") REFERENCES "service_users"."MedicalConditionCatalog"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_users"."ServiceUserReasonableAdjustment" ADD CONSTRAINT "ServiceUserReasonableAdjustment_serviceUserId_fkey" FOREIGN KEY ("serviceUserId") REFERENCES "service_users"."ServiceUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_users"."ServiceUserMedicalHistoryEvent" ADD CONSTRAINT "ServiceUserMedicalHistoryEvent_serviceUserId_fkey" FOREIGN KEY ("serviceUserId") REFERENCES "service_users"."ServiceUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_users"."ServiceUserMonitoringConfig" ADD CONSTRAINT "ServiceUserMonitoringConfig_serviceUserId_fkey" FOREIGN KEY ("serviceUserId") REFERENCES "service_users"."ServiceUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_users"."ServiceUserMonitoringConfig" ADD CONSTRAINT "ServiceUserMonitoringConfig_observationTypeId_fkey" FOREIGN KEY ("observationTypeId") REFERENCES "service_users"."ObservationType"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_users"."ServiceUserUsualParameter" ADD CONSTRAINT "ServiceUserUsualParameter_serviceUserId_fkey" FOREIGN KEY ("serviceUserId") REFERENCES "service_users"."ServiceUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_users"."ServiceUserUsualParameter" ADD CONSTRAINT "ServiceUserUsualParameter_observationTypeId_fkey" FOREIGN KEY ("observationTypeId") REFERENCES "service_users"."ObservationType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Permission catalogue (identity.Permission). Additive upserts only.
INSERT INTO "identity"."Permission" ("id", "key", "isActive", "createdAt", "updatedAt")
SELECT gen_random_uuid(), k, true, NOW(), NOW()
FROM unnest(ARRAY[
  'service_users.medical_conditions.read',
  'service_users.medical_conditions.create',
  'service_users.medical_conditions.update',
  'service_users.medical_conditions.delete',
  'service_users.medical_adjustments.read',
  'service_users.medical_adjustments.create',
  'service_users.medical_adjustments.update',
  'service_users.medical_adjustments.delete',
  'service_users.medical_history.read',
  'service_users.medical_history.create',
  'service_users.medical_history.update',
  'service_users.medical_history.delete',
  'service_users.medical_monitoring.read',
  'service_users.medical_monitoring.update',
  'service_users.medical_usual_parameters.read',
  'service_users.medical_usual_parameters.update'
]::text[]) AS k
WHERE NOT EXISTS (
  SELECT 1 FROM "identity"."Permission" p WHERE p."key" = k
);

UPDATE "identity"."Permission"
SET "isActive" = true, "deletedAt" = NULL, "updatedAt" = NOW()
WHERE "key" LIKE 'service_users.medical_%';

-- Super Admin / Admin / Manager / Care Coordinator: full clinical medical SoT access
INSERT INTO "identity"."RolePermission" ("id", "roleId", "permissionId", "createdAt")
SELECT gen_random_uuid(), r."id", p."id", NOW()
FROM "identity"."Role" r
CROSS JOIN "identity"."Permission" p
WHERE r."name" IN ('Super Admin', 'Admin', 'Manager', 'Care Coordinator')
  AND r."deletedAt" IS NULL
  AND p."key" LIKE 'service_users.medical_%'
  AND p."deletedAt" IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM "identity"."RolePermission" rp
    WHERE rp."roleId" = r."id" AND rp."permissionId" = p."id"
  );

-- Senior Carer / Carer: read-only clinical medical SoT
INSERT INTO "identity"."RolePermission" ("id", "roleId", "permissionId", "createdAt")
SELECT gen_random_uuid(), r."id", p."id", NOW()
FROM "identity"."Role" r
CROSS JOIN "identity"."Permission" p
WHERE r."name" IN ('Senior Carer/Nurse', 'Carer/Domestic')
  AND r."deletedAt" IS NULL
  AND p."key" IN (
    'service_users.medical_conditions.read',
    'service_users.medical_adjustments.read',
    'service_users.medical_history.read',
    'service_users.medical_monitoring.read',
    'service_users.medical_usual_parameters.read'
  )
  AND p."deletedAt" IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM "identity"."RolePermission" rp
    WHERE rp."roleId" = r."id" AND rp."permissionId" = p."id"
  );
