-- Vital sign accepted ranges catalog (Settings → Accepted ranges, §4 IA guidance).

CREATE TABLE "lookups"."VitalAcceptedRangeCatalog" (
    "id" UUID NOT NULL,
    "fieldKey" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "min" DOUBLE PRECISION NOT NULL,
    "max" DOUBLE PRECISION NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "column" VARCHAR(8) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VitalAcceptedRangeCatalog_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "VitalAcceptedRangeCatalog_fieldKey_key" ON "lookups"."VitalAcceptedRangeCatalog"("fieldKey");

CREATE INDEX "VitalAcceptedRangeCatalog_isActive_idx" ON "lookups"."VitalAcceptedRangeCatalog"("isActive");

CREATE INDEX "VitalAcceptedRangeCatalog_sortOrder_idx" ON "lookups"."VitalAcceptedRangeCatalog"("sortOrder");
