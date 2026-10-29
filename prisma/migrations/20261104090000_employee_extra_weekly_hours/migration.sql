-- Extra weekly hours a manager gives a carer for a day, a week or a date range (with history).
CREATE TYPE "employees"."EmployeeExtraHoursPeriod" AS ENUM ('DAY', 'WEEK', 'RANGE');

CREATE TABLE "employees"."EmployeeExtraWeeklyHours" (
    "id" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "periodType" "employees"."EmployeeExtraHoursPeriod" NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "extraHours" DOUBLE PRECISION NOT NULL,
    "reason" TEXT,
    "grantedById" UUID,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "outcome" JSONB,
    "cancelledById" UUID,
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmployeeExtraWeeklyHours_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "EmployeeExtraWeeklyHours_employeeId_startDate_endDate_idx"
    ON "employees"."EmployeeExtraWeeklyHours"("employeeId", "startDate", "endDate");

-- Permission: give carers extra weekly hours (Super Admin, Admin, Manager, Staff Allocation, Master Staff Allocation).
INSERT INTO "identity"."Permission" ("id", "key", "description", "isActive", "createdAt", "updatedAt")
SELECT gen_random_uuid(), 'employees.extra_hours.manage', 'Give or cancel extra weekly hours for a carer', true, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM "identity"."Permission" p WHERE p."key" = 'employees.extra_hours.manage');

INSERT INTO "identity"."RolePermission" ("id", "roleId", "permissionId", "createdAt")
SELECT gen_random_uuid(), r."id", p."id", NOW()
FROM "identity"."Role" r
CROSS JOIN "identity"."Permission" p
WHERE r."name" IN ('Super Admin', 'Admin', 'Manager', 'Staff Allocation', 'Master Staff Allocation')
  AND r."deletedAt" IS NULL
  AND p."key" = 'employees.extra_hours.manage'
  AND NOT EXISTS (
    SELECT 1 FROM "identity"."RolePermission" rp
    WHERE rp."roleId" = r."id" AND rp."permissionId" = p."id"
  );
