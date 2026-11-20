-- Ready-made mock CQC inspections: templates seeded from prisma/seed-data/mock-inspection-library, and
-- the template an inspection was started from. Additive only.

-- AlterTable
ALTER TABLE "quality"."CqcMockInspection" ADD COLUMN     "templateId" UUID;

-- CreateTable
CREATE TABLE "quality"."CqcMockInspectionTemplate" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "groupCode" TEXT NOT NULL,
    "groupName" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "whenToUse" TEXT NOT NULL,
    "estimatedMinutes" INTEGER NOT NULL,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "statements" JSONB NOT NULL,
    "sources" JSONB NOT NULL,
    "researchedOn" DATE NOT NULL,
    "contentHash" TEXT NOT NULL,
    "retiredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CqcMockInspectionTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CqcMockInspectionTemplate_code_key" ON "quality"."CqcMockInspectionTemplate"("code");

-- CreateIndex
CREATE INDEX "CqcMockInspection_templateId_idx" ON "quality"."CqcMockInspection"("templateId");

-- AddForeignKey
ALTER TABLE "quality"."CqcMockInspection" ADD CONSTRAINT "CqcMockInspection_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "quality"."CqcMockInspectionTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

