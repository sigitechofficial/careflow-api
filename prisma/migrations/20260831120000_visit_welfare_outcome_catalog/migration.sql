-- Adds the missing scheduling.VisitWelfareOutcomeCatalog table.
--
-- Context: the model existed in schema.prisma (and in dev/dump databases via
-- `db push`) but no migration ever created it, so fresh databases (live) are
-- missing the table — the employee-app visit-details endpoint fails with P2021.
-- This migration is purely additive: one standalone catalog table, no foreign
-- keys, no changes to existing tables.

-- CreateTable
CREATE TABLE "scheduling"."VisitWelfareOutcomeCatalog" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "tone" VARCHAR(8) NOT NULL DEFAULT 'ok',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VisitWelfareOutcomeCatalog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "VisitWelfareOutcomeCatalog_code_key" ON "scheduling"."VisitWelfareOutcomeCatalog"("code");

-- CreateIndex
CREATE INDEX "VisitWelfareOutcomeCatalog_isActive_idx" ON "scheduling"."VisitWelfareOutcomeCatalog"("isActive");

-- CreateIndex
CREATE INDEX "VisitWelfareOutcomeCatalog_sortOrder_idx" ON "scheduling"."VisitWelfareOutcomeCatalog"("sortOrder");
