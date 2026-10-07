-- Corrections to raised incident fields (original value kept, reason required) and append-only
-- clarification notes on the reporter's own account.
CREATE TYPE "incidents"."IncidentClarificationField" AS ENUM ('DESCRIPTION', 'CONTEXT_BEFORE', 'CONTEXT_AFTER', 'IMMEDIATE_ACTIONS', 'PEOPLE_INVOLVED', 'EMERGENCY_SERVICES');

CREATE TABLE "incidents"."IncidentCorrection" (
    "id" UUID NOT NULL,
    "incidentId" UUID NOT NULL,
    "batchId" UUID NOT NULL,
    "fieldKey" TEXT NOT NULL,
    "fromValue" JSONB,
    "toValue" JSONB,
    "fromLabel" TEXT,
    "toLabel" TEXT,
    "reason" TEXT NOT NULL,
    "correctedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "IncidentCorrection_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "IncidentCorrection_incidentId_createdAt_idx" ON "incidents"."IncidentCorrection"("incidentId", "createdAt");
ALTER TABLE "incidents"."IncidentCorrection" ADD CONSTRAINT "IncidentCorrection_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "incidents"."Incident"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "incidents"."IncidentClarificationNote" (
    "id" UUID NOT NULL,
    "incidentId" UUID NOT NULL,
    "field" "incidents"."IncidentClarificationField" NOT NULL,
    "note" TEXT NOT NULL,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "IncidentClarificationNote_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "IncidentClarificationNote_incidentId_createdAt_idx" ON "incidents"."IncidentClarificationNote"("incidentId", "createdAt");
ALTER TABLE "incidents"."IncidentClarificationNote" ADD CONSTRAINT "IncidentClarificationNote_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "incidents"."Incident"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Permission: correct raised details / add clarification notes (managers and admins).
INSERT INTO "identity"."Permission" ("id", "key", "description", "isActive", "createdAt", "updatedAt")
SELECT gen_random_uuid(), 'incidents.correct', 'Correct raised incident details and add clarification notes', true, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM "identity"."Permission" p WHERE p."key" = 'incidents.correct');

INSERT INTO "identity"."RolePermission" ("id", "roleId", "permissionId", "createdAt")
SELECT gen_random_uuid(), r."id", p."id", NOW()
FROM "identity"."Role" r
CROSS JOIN "identity"."Permission" p
WHERE r."name" IN ('Super Admin', 'Admin', 'Manager')
  AND p."key" = 'incidents.correct'
  AND NOT EXISTS (
    SELECT 1 FROM "identity"."RolePermission" rp
    WHERE rp."roleId" = r."id" AND rp."permissionId" = p."id"
  );
