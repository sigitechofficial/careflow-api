-- On-call rota and out-of-hours call log (Operations › On-call). Additive only.

CREATE TYPE "scheduling"."OnCallTier" AS ENUM ('FIRST_LINE', 'SECOND_LINE');
CREATE TYPE "scheduling"."OnCallCallerType" AS ENUM ('CARER', 'SERVICE_USER', 'FAMILY', 'PROFESSIONAL', 'OTHER');
CREATE TYPE "scheduling"."OnCallCallCategory" AS ENUM ('CARER_SICKNESS', 'LATE_OR_MISSED_VISIT', 'ACCESS_PROBLEM', 'SERVICE_USER_UNWELL', 'MEDICATION', 'CONCERN_OR_COMPLAINT', 'OTHER');
CREATE TYPE "scheduling"."OnCallCallStatus" AS ENUM ('OPEN', 'CLOSED');

CREATE TABLE "scheduling"."OnCallShift" (
    "id" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "locationId" UUID,
    "tier" "scheduling"."OnCallTier" NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "notes" VARCHAR(500),
    "createdById" UUID,
    "updatedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    CONSTRAINT "OnCallShift_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "OnCallShift_startsAt_idx" ON "scheduling"."OnCallShift"("startsAt");
CREATE INDEX "OnCallShift_endsAt_idx" ON "scheduling"."OnCallShift"("endsAt");
CREATE INDEX "OnCallShift_employeeId_idx" ON "scheduling"."OnCallShift"("employeeId");

CREATE TABLE "scheduling"."OnCallCall" (
    "id" UUID NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "takenByUserId" UUID,
    "callerType" "scheduling"."OnCallCallerType" NOT NULL,
    "callerName" VARCHAR(120) NOT NULL,
    "callerPhone" VARCHAR(40),
    "callerEmployeeId" UUID,
    "serviceUserId" UUID,
    "locationId" UUID,
    "category" "scheduling"."OnCallCallCategory" NOT NULL,
    "summary" VARCHAR(2000) NOT NULL,
    "actionTaken" VARCHAR(2000),
    "followUpRequired" BOOLEAN NOT NULL DEFAULT false,
    "status" "scheduling"."OnCallCallStatus" NOT NULL DEFAULT 'OPEN',
    "closedAt" TIMESTAMP(3),
    "closedByUserId" UUID,
    "closingNote" VARCHAR(1000),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    CONSTRAINT "OnCallCall_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "OnCallCall_receivedAt_idx" ON "scheduling"."OnCallCall"("receivedAt");
CREATE INDEX "OnCallCall_status_idx" ON "scheduling"."OnCallCall"("status");
CREATE INDEX "OnCallCall_serviceUserId_idx" ON "scheduling"."OnCallCall"("serviceUserId");

-- Permissions: view, manage the rota, record and close calls.
INSERT INTO "identity"."Permission" ("id", "key", "description", "isActive", "createdAt", "updatedAt")
SELECT gen_random_uuid(), v.key, v.description, true, NOW(), NOW()
FROM (VALUES
  ('on_call.read', 'View the on-call rota and out-of-hours calls'),
  ('on_call.manage', 'Add, change and remove on-call shifts'),
  ('on_call.log', 'Record and close out-of-hours calls')
) AS v(key, description)
WHERE NOT EXISTS (SELECT 1 FROM "identity"."Permission" p WHERE p."key" = v.key);

-- Super Admin and Admin get them; other roles are given them in Roles & permissions.
INSERT INTO "identity"."RolePermission" ("id", "roleId", "permissionId", "createdAt")
SELECT gen_random_uuid(), r."id", p."id", NOW()
FROM "identity"."Role" r
CROSS JOIN "identity"."Permission" p
WHERE r."name" IN ('Super Admin', 'Admin')
  AND p."key" IN ('on_call.read', 'on_call.manage', 'on_call.log')
  AND NOT EXISTS (
    SELECT 1 FROM "identity"."RolePermission" x
    WHERE x."roleId" = r."id" AND x."permissionId" = p."id"
  );
