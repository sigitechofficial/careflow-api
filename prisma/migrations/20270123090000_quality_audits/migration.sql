-- Quality audits (Governance → Audits): ready-made templates seeded from prisma/seed-data/audit-library,
-- audits carried out from them, their answers and actions. Additive only.

-- CreateEnum
CREATE TYPE "quality"."QualityAuditStatus" AS ENUM ('IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "quality"."QualityAuditAnswerValue" AS ENUM ('MET', 'NOT_MET');

-- CreateEnum
CREATE TYPE "quality"."QualityAuditActionStatus" AS ENUM ('OPEN', 'DONE');

-- CreateTable
CREATE TABLE "quality"."QualityAuditTemplate" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "keyQuestionCode" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "frequency" TEXT NOT NULL,
    "estimatedMinutes" INTEGER NOT NULL,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "sections" JSONB NOT NULL,
    "cqcStatementCodes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "sources" JSONB NOT NULL,
    "researchedOn" DATE NOT NULL,
    "contentHash" TEXT NOT NULL,
    "retiredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QualityAuditTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quality"."QualityAudit" (
    "id" UUID NOT NULL,
    "templateId" UUID NOT NULL,
    "sections" JSONB NOT NULL,
    "locationId" UUID,
    "title" TEXT NOT NULL,
    "auditDate" DATE NOT NULL,
    "auditorId" UUID,
    "status" "quality"."QualityAuditStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "summary" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "result" JSONB,
    "createdById" UUID,
    "updatedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QualityAudit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quality"."QualityAuditAnswer" (
    "id" UUID NOT NULL,
    "auditId" UUID NOT NULL,
    "standardId" TEXT NOT NULL,
    "answer" "quality"."QualityAuditAnswerValue" NOT NULL,
    "celebrate" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,
    "answeredById" UUID,
    "answeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QualityAuditAnswer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quality"."QualityAuditAction" (
    "id" UUID NOT NULL,
    "auditId" UUID NOT NULL,
    "standardId" TEXT,
    "title" TEXT NOT NULL,
    "detail" TEXT,
    "assignedEmployeeId" UUID,
    "dueAt" DATE,
    "urgent" BOOLEAN NOT NULL DEFAULT false,
    "status" "quality"."QualityAuditActionStatus" NOT NULL DEFAULT 'OPEN',
    "completedAt" TIMESTAMP(3),
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QualityAuditAction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "QualityAuditTemplate_code_key" ON "quality"."QualityAuditTemplate"("code");

-- CreateIndex
CREATE INDEX "QualityAudit_locationId_idx" ON "quality"."QualityAudit"("locationId");

-- CreateIndex
CREATE INDEX "QualityAudit_status_idx" ON "quality"."QualityAudit"("status");

-- CreateIndex
CREATE INDEX "QualityAudit_templateId_idx" ON "quality"."QualityAudit"("templateId");

-- CreateIndex
CREATE UNIQUE INDEX "QualityAuditAnswer_auditId_standardId_key" ON "quality"."QualityAuditAnswer"("auditId", "standardId");

-- CreateIndex
CREATE INDEX "QualityAuditAction_auditId_idx" ON "quality"."QualityAuditAction"("auditId");

-- CreateIndex
CREATE INDEX "QualityAuditAction_status_dueAt_idx" ON "quality"."QualityAuditAction"("status", "dueAt");

-- AddForeignKey
ALTER TABLE "quality"."QualityAudit" ADD CONSTRAINT "QualityAudit_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "quality"."QualityAuditTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quality"."QualityAuditAnswer" ADD CONSTRAINT "QualityAuditAnswer_auditId_fkey" FOREIGN KEY ("auditId") REFERENCES "quality"."QualityAudit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quality"."QualityAuditAction" ADD CONSTRAINT "QualityAuditAction_auditId_fkey" FOREIGN KEY ("auditId") REFERENCES "quality"."QualityAudit"("id") ON DELETE CASCADE ON UPDATE CASCADE;
