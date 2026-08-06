-- ECM categorization threshold lookups (closed catalog).
CREATE TABLE IF NOT EXISTS "lookups"."EcmThresholdLookup" (
    "id" UUID NOT NULL,
    "code" VARCHAR(64) NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT,
    "groupCode" VARCHAR(32) NOT NULL,
    "relatedTile" VARCHAR(32),
    "valueInt" INTEGER NOT NULL,
    "unit" VARCHAR(16) NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EcmThresholdLookup_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "EcmThresholdLookup_code_key"
  ON "lookups"."EcmThresholdLookup"("code");

CREATE INDEX IF NOT EXISTS "EcmThresholdLookup_groupCode_idx"
  ON "lookups"."EcmThresholdLookup"("groupCode");

CREATE INDEX IF NOT EXISTS "EcmThresholdLookup_isActive_idx"
  ON "lookups"."EcmThresholdLookup"("isActive");

CREATE INDEX IF NOT EXISTS "EcmThresholdLookup_sortOrder_idx"
  ON "lookups"."EcmThresholdLookup"("sortOrder");
