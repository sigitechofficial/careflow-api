-- CreateEnum
CREATE TYPE "identity"."RoleTaskRecurrence" AS ENUM ('NONE', 'DAILY', 'WEEKLY', 'MONTHLY');

-- CreateEnum
CREATE TYPE "identity"."RoleTaskStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'DONE', 'CANCELLED');

-- CreateTable
CREATE TABLE "identity"."RoleTaskTemplate" (
    "id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "roleId" UUID NOT NULL,
    "locationId" UUID,
    "link" TEXT,
    "recurrence" "identity"."RoleTaskRecurrence" NOT NULL DEFAULT 'NONE',
    "startDate" DATE NOT NULL,
    "weekday" INTEGER,
    "dayOfMonth" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" UUID,
    "updatedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "RoleTaskTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "identity"."RoleTask" (
    "id" UUID NOT NULL,
    "templateId" UUID NOT NULL,
    "roleId" UUID NOT NULL,
    "locationId" UUID,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "link" TEXT,
    "dueDate" DATE NOT NULL,
    "status" "identity"."RoleTaskStatus" NOT NULL DEFAULT 'OPEN',
    "note" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "completedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RoleTask_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RoleTaskTemplate_roleId_idx" ON "identity"."RoleTaskTemplate"("roleId");

-- CreateIndex
CREATE INDEX "RoleTaskTemplate_deletedAt_idx" ON "identity"."RoleTaskTemplate"("deletedAt");

-- CreateIndex
CREATE INDEX "RoleTask_roleId_status_idx" ON "identity"."RoleTask"("roleId", "status");

-- CreateIndex
CREATE INDEX "RoleTask_dueDate_idx" ON "identity"."RoleTask"("dueDate");

-- CreateIndex
CREATE UNIQUE INDEX "RoleTask_templateId_dueDate_key" ON "identity"."RoleTask"("templateId", "dueDate");

-- AddForeignKey
ALTER TABLE "identity"."RoleTaskTemplate" ADD CONSTRAINT "RoleTaskTemplate_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "identity"."Role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "identity"."RoleTaskTemplate" ADD CONSTRAINT "RoleTaskTemplate_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "lookups"."Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "identity"."RoleTask" ADD CONSTRAINT "RoleTask_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "identity"."RoleTaskTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "identity"."RoleTask" ADD CONSTRAINT "RoleTask_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "identity"."Role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "identity"."RoleTask" ADD CONSTRAINT "RoleTask_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "lookups"."Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Permission: create and manage role tasks (Super Admin, Admin, Manager).
INSERT INTO "identity"."Permission" ("id", "key", "description", "isActive", "createdAt", "updatedAt")
SELECT gen_random_uuid(), 'role_tasks.manage', 'Create and manage tasks for office-user roles', true, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM "identity"."Permission" p WHERE p."key" = 'role_tasks.manage');

INSERT INTO "identity"."RolePermission" ("id", "roleId", "permissionId", "createdAt")
SELECT gen_random_uuid(), r."id", p."id", NOW()
FROM "identity"."Role" r
CROSS JOIN "identity"."Permission" p
WHERE r."name" IN ('Super Admin', 'Admin', 'Manager')
  AND p."key" = 'role_tasks.manage'
  AND NOT EXISTS (
    SELECT 1 FROM "identity"."RolePermission" rp
    WHERE rp."roleId" = r."id" AND rp."permissionId" = p."id"
  );
