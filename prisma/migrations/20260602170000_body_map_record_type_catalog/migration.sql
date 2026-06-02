-- Shared body map record type / wound type catalogue (initial assessment + body map).

CREATE TABLE "service_users"."BodyMapRecordTypeCatalog" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "parentId" UUID,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "initialAssessmentWoundType" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BodyMapRecordTypeCatalog_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BodyMapRecordTypeCatalog_code_key" ON "service_users"."BodyMapRecordTypeCatalog"("code");
CREATE INDEX "BodyMapRecordTypeCatalog_parentId_idx" ON "service_users"."BodyMapRecordTypeCatalog"("parentId");
CREATE INDEX "BodyMapRecordTypeCatalog_isActive_idx" ON "service_users"."BodyMapRecordTypeCatalog"("isActive");
CREATE INDEX "BodyMapRecordTypeCatalog_initialAssessmentWoundType_idx" ON "service_users"."BodyMapRecordTypeCatalog"("initialAssessmentWoundType");

ALTER TABLE "service_users"."BodyMapRecordTypeCatalog" ADD CONSTRAINT "BodyMapRecordTypeCatalog_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "service_users"."BodyMapRecordTypeCatalog"("id") ON DELETE SET NULL ON UPDATE CASCADE;
