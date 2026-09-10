-- Operational Alerts foundation. Additive only: new schema, enums, Alert table,
-- indexes, cross-schema FKs to identity.User / service_users.ServiceUser, and
-- alerts.* permission catalogue rows. Does not drop or alter existing medical,
-- incident, ECM, body-map, notification, or policy tables.

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "alerts";

-- CreateEnum
CREATE TYPE "alerts"."AlertType" AS ENUM (
  'MANUAL',
  'CARE_PLAN_REVIEW_APPROACHING',
  'CARE_PLAN_REVIEW_OVERDUE',
  'MEDICATION_MISSED',
  'MEDICATION_REFUSED',
  'MEDICATION_NOT_GIVEN',
  'INCIDENT_ACTION_REQUIRED',
  'INCIDENT_FOLLOW_UP_OVERDUE',
  'VISIT_LATE',
  'VISIT_MISSED',
  'OBSERVATION_ABNORMAL',
  'IA_HIGH_RISK',
  'COMPLIANCE_EXPIRING',
  'COMPLIANCE_EXPIRED',
  'ESCALATION_REQUIRED'
);

-- CreateEnum
CREATE TYPE "alerts"."AlertCategory" AS ENUM (
  'CLINICAL',
  'MEDICATION',
  'RISK_AND_SAFEGUARDING',
  'CARE_PLAN',
  'VISITS',
  'INCIDENTS',
  'OBSERVATIONS',
  'COMPLIANCE',
  'STAFF',
  'SYSTEM'
);

-- CreateEnum
CREATE TYPE "alerts"."AlertSeverity" AS ENUM (
  'CRITICAL',
  'HIGH',
  'MEDIUM',
  'LOW',
  'INFO'
);

-- CreateEnum
CREATE TYPE "alerts"."AlertStatus" AS ENUM (
  'NEW',
  'ACKNOWLEDGED',
  'IN_PROGRESS',
  'RESOLVED',
  'DISMISSED'
);

-- CreateEnum
CREATE TYPE "alerts"."AlertEscalationState" AS ENUM (
  'NONE',
  'PENDING',
  'ESCALATED',
  'OVERDUE'
);

-- CreateEnum
CREATE TYPE "alerts"."AlertPriority" AS ENUM (
  'HIGH',
  'NORMAL',
  'LOW'
);

-- CreateTable
CREATE TABLE "alerts"."Alert" (
    "id" UUID NOT NULL,
    "alertType" "alerts"."AlertType" NOT NULL,
    "category" "alerts"."AlertCategory" NOT NULL,
    "severity" "alerts"."AlertSeverity" NOT NULL DEFAULT 'MEDIUM',
    "priority" "alerts"."AlertPriority" NOT NULL DEFAULT 'NORMAL',
    "status" "alerts"."AlertStatus" NOT NULL DEFAULT 'NEW',
    "title" TEXT NOT NULL,
    "description" TEXT,
    "serviceUserId" UUID,
    "employeeId" UUID,
    "locationId" UUID,
    "assignedUserId" UUID,
    "sourceModule" VARCHAR(80) NOT NULL,
    "sourceRecordId" UUID,
    "eventKey" VARCHAR(160) NOT NULL,
    "idempotencyKey" VARCHAR(400) NOT NULL,
    "triggeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dueAt" TIMESTAMP(3),
    "acknowledgedAt" TIMESTAMP(3),
    "acknowledgedById" UUID,
    "startedAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "resolvedById" UUID,
    "resolutionNote" TEXT,
    "dismissedAt" TIMESTAMP(3),
    "dismissedById" UUID,
    "dismissReason" TEXT,
    "escalationState" "alerts"."AlertEscalationState" NOT NULL DEFAULT 'NONE',
    "escalatedAt" TIMESTAMP(3),
    "escalationDeadlineAt" TIMESTAMP(3),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" UUID,
    "updatedById" UUID,

    CONSTRAINT "Alert_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Alert_idempotencyKey_key" ON "alerts"."Alert"("idempotencyKey");

-- CreateIndex
CREATE INDEX "Alert_serviceUserId_idx" ON "alerts"."Alert"("serviceUserId");

-- CreateIndex
CREATE INDEX "Alert_status_idx" ON "alerts"."Alert"("status");

-- CreateIndex
CREATE INDEX "Alert_severity_idx" ON "alerts"."Alert"("severity");

-- CreateIndex
CREATE INDEX "Alert_category_idx" ON "alerts"."Alert"("category");

-- CreateIndex
CREATE INDEX "Alert_alertType_idx" ON "alerts"."Alert"("alertType");

-- CreateIndex
CREATE INDEX "Alert_sourceModule_sourceRecordId_idx" ON "alerts"."Alert"("sourceModule", "sourceRecordId");

-- CreateIndex
CREATE INDEX "Alert_sourceModule_alertType_idx" ON "alerts"."Alert"("sourceModule", "alertType");

-- CreateIndex
CREATE INDEX "Alert_dueAt_idx" ON "alerts"."Alert"("dueAt");

-- CreateIndex
CREATE INDEX "Alert_createdAt_idx" ON "alerts"."Alert"("createdAt");

-- CreateIndex
CREATE INDEX "Alert_triggeredAt_idx" ON "alerts"."Alert"("triggeredAt");

-- CreateIndex
CREATE INDEX "Alert_locationId_idx" ON "alerts"."Alert"("locationId");

-- CreateIndex
CREATE INDEX "Alert_assignedUserId_idx" ON "alerts"."Alert"("assignedUserId");

-- CreateIndex
CREATE INDEX "Alert_employeeId_idx" ON "alerts"."Alert"("employeeId");

-- CreateIndex
CREATE INDEX "Alert_escalationState_idx" ON "alerts"."Alert"("escalationState");

-- CreateIndex
CREATE INDEX "Alert_status_severity_createdAt_idx" ON "alerts"."Alert"("status", "severity", "createdAt");

-- AddForeignKey
ALTER TABLE "alerts"."Alert" ADD CONSTRAINT "Alert_serviceUserId_fkey" FOREIGN KEY ("serviceUserId") REFERENCES "service_users"."ServiceUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alerts"."Alert" ADD CONSTRAINT "Alert_assignedUserId_fkey" FOREIGN KEY ("assignedUserId") REFERENCES "identity"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alerts"."Alert" ADD CONSTRAINT "Alert_acknowledgedById_fkey" FOREIGN KEY ("acknowledgedById") REFERENCES "identity"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alerts"."Alert" ADD CONSTRAINT "Alert_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "identity"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alerts"."Alert" ADD CONSTRAINT "Alert_dismissedById_fkey" FOREIGN KEY ("dismissedById") REFERENCES "identity"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alerts"."Alert" ADD CONSTRAINT "Alert_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "identity"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alerts"."Alert" ADD CONSTRAINT "Alert_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "identity"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Alerts permission catalogue (idempotent).
INSERT INTO "identity"."Permission" ("id", "key", "isActive", "createdAt", "updatedAt")
SELECT gen_random_uuid(), k, true, NOW(), NOW()
FROM unnest(ARRAY[
  'alerts.read',
  'alerts.create',
  'alerts.update',
  'alerts.assign',
  'alerts.acknowledge',
  'alerts.resolve',
  'alerts.dismiss',
  'alerts.configure'
]::text[]) AS k
WHERE NOT EXISTS (
  SELECT 1 FROM "identity"."Permission" p WHERE p."key" = k
);

UPDATE "identity"."Permission"
SET "isActive" = true, "deletedAt" = NULL, "updatedAt" = NOW()
WHERE "key" LIKE 'alerts.%';

-- Super Admin / Admin: all alerts permissions
INSERT INTO "identity"."RolePermission" ("id", "roleId", "permissionId", "createdAt")
SELECT gen_random_uuid(), r."id", p."id", NOW()
FROM "identity"."Role" r
CROSS JOIN "identity"."Permission" p
WHERE r."name" IN ('Super Admin', 'Admin')
  AND r."deletedAt" IS NULL
  AND p."key" LIKE 'alerts.%'
  AND p."deletedAt" IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM "identity"."RolePermission" rp
    WHERE rp."roleId" = r."id" AND rp."permissionId" = p."id"
  );

-- Manager / Care Coordinator: operational alerts (no configure)
INSERT INTO "identity"."RolePermission" ("id", "roleId", "permissionId", "createdAt")
SELECT gen_random_uuid(), r."id", p."id", NOW()
FROM "identity"."Role" r
CROSS JOIN "identity"."Permission" p
WHERE r."name" IN ('Manager', 'Care Coordinator')
  AND r."deletedAt" IS NULL
  AND p."key" IN (
    'alerts.read',
    'alerts.create',
    'alerts.update',
    'alerts.assign',
    'alerts.acknowledge',
    'alerts.resolve',
    'alerts.dismiss'
  )
  AND p."deletedAt" IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM "identity"."RolePermission" rp
    WHERE rp."roleId" = r."id" AND rp."permissionId" = p."id"
  );

-- Senior Carer / Carer: read + acknowledge
INSERT INTO "identity"."RolePermission" ("id", "roleId", "permissionId", "createdAt")
SELECT gen_random_uuid(), r."id", p."id", NOW()
FROM "identity"."Role" r
CROSS JOIN "identity"."Permission" p
WHERE r."name" IN ('Senior Carer/Nurse', 'Carer/Domestic')
  AND r."deletedAt" IS NULL
  AND p."key" IN ('alerts.read', 'alerts.acknowledge')
  AND p."deletedAt" IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM "identity"."RolePermission" rp
    WHERE rp."roleId" = r."id" AND rp."permissionId" = p."id"
  );
