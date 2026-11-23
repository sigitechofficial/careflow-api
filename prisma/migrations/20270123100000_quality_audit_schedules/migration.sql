-- Audits: areas, the organisation's own templates, schedules (due / missed audits) and the audited item.
-- Additive only: new tables and columns; auditDate and startedAt may now be empty for audits not started yet.

-- AlterEnum (PostgreSQL 12 and later allow both values in one migration)
ALTER TYPE "quality"."QualityAuditStatus" ADD VALUE 'DUE';
ALTER TYPE "quality"."QualityAuditStatus" ADD VALUE 'MISSED';

-- AlterTable
ALTER TABLE "quality"."QualityAudit" ADD COLUMN     "accountableUserId" UUID,
ADD COLUMN     "auditedItemLabel" TEXT,
ADD COLUMN     "auditedItemValue" TEXT,
ADD COLUMN     "dueDate" DATE,
ADD COLUMN     "earlyDays" INTEGER,
ADD COLUMN     "lateDays" INTEGER,
ADD COLUMN     "missedAt" TIMESTAMP(3),
ADD COLUMN     "scheduleId" UUID,
ALTER COLUMN "auditDate" DROP NOT NULL,
ALTER COLUMN "startedAt" DROP NOT NULL;

-- AlterTable
ALTER TABLE "quality"."QualityAuditTemplate" ADD COLUMN     "areaId" UUID,
ADD COLUMN     "auditedItemLabel" TEXT,
ADD COLUMN     "createdById" UUID,
ADD COLUMN     "earlyDays" INTEGER NOT NULL DEFAULT 2,
ADD COLUMN     "introduction" TEXT,
ADD COLUMN     "isCustom" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "lateDays" INTEGER NOT NULL DEFAULT 2,
ADD COLUMN     "locationIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
ALTER COLUMN "keyQuestionCode" DROP NOT NULL,
ALTER COLUMN "estimatedMinutes" SET DEFAULT 30;

-- CreateTable
CREATE TABLE "quality"."QualityAuditArea" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "archivedAt" TIMESTAMP(3),
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QualityAuditArea_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quality"."QualityAuditSchedule" (
    "id" UUID NOT NULL,
    "templateId" UUID NOT NULL,
    "locationId" UUID,
    "frequency" TEXT NOT NULL,
    "earlyDays" INTEGER NOT NULL DEFAULT 2,
    "lateDays" INTEGER NOT NULL DEFAULT 2,
    "firstDueDate" DATE NOT NULL,
    "accountableUserId" UUID,
    "stoppedAt" TIMESTAMP(3),
    "createdById" UUID,
    "updatedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QualityAuditSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "QualityAuditArea_code_key" ON "quality"."QualityAuditArea"("code");

-- CreateIndex
CREATE INDEX "QualityAuditSchedule_templateId_idx" ON "quality"."QualityAuditSchedule"("templateId");

-- CreateIndex
CREATE INDEX "QualityAuditSchedule_locationId_idx" ON "quality"."QualityAuditSchedule"("locationId");

-- CreateIndex
CREATE INDEX "QualityAudit_dueDate_idx" ON "quality"."QualityAudit"("dueDate");

-- CreateIndex
CREATE UNIQUE INDEX "QualityAudit_scheduleId_dueDate_key" ON "quality"."QualityAudit"("scheduleId", "dueDate");

-- CreateIndex
CREATE INDEX "QualityAuditTemplate_areaId_idx" ON "quality"."QualityAuditTemplate"("areaId");

-- AddForeignKey
ALTER TABLE "quality"."QualityAuditSchedule" ADD CONSTRAINT "QualityAuditSchedule_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "quality"."QualityAuditTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quality"."QualityAuditTemplate" ADD CONSTRAINT "QualityAuditTemplate_areaId_fkey" FOREIGN KEY ("areaId") REFERENCES "quality"."QualityAuditArea"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quality"."QualityAudit" ADD CONSTRAINT "QualityAudit_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "quality"."QualityAuditSchedule"("id") ON DELETE SET NULL ON UPDATE CASCADE;
