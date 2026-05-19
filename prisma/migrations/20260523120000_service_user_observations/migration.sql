-- Service user observations: lookup catalogues and recorded observations.

CREATE TYPE "service_users"."ObservationValueKind" AS ENUM ('NUMERIC', 'WELLBEING', 'COMPOSITE');

CREATE TABLE "service_users"."ObservationType" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "valueKind" "service_users"."ObservationValueKind" NOT NULL,
    "usesNews2" BOOLEAN NOT NULL DEFAULT false,
    "unitLabel" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ObservationType_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ObservationType_code_key" ON "service_users"."ObservationType"("code");
CREATE INDEX "ObservationType_isActive_idx" ON "service_users"."ObservationType"("isActive");
CREATE INDEX "ObservationType_sortOrder_idx" ON "service_users"."ObservationType"("sortOrder");

CREATE TABLE "service_users"."ObservationShareTarget" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ObservationShareTarget_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ObservationShareTarget_code_key" ON "service_users"."ObservationShareTarget"("code");
CREATE INDEX "ObservationShareTarget_isActive_idx" ON "service_users"."ObservationShareTarget"("isActive");

CREATE TABLE "service_users"."WellbeingDimension" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WellbeingDimension_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WellbeingDimension_code_key" ON "service_users"."WellbeingDimension"("code");
CREATE INDEX "WellbeingDimension_isActive_idx" ON "service_users"."WellbeingDimension"("isActive");

CREATE TABLE "service_users"."WellbeingLevelLabel" (
    "id" UUID NOT NULL,
    "dimensionId" UUID NOT NULL,
    "level" INTEGER NOT NULL,
    "label" TEXT NOT NULL,

    CONSTRAINT "WellbeingLevelLabel_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WellbeingLevelLabel_dimensionId_level_key" ON "service_users"."WellbeingLevelLabel"("dimensionId", "level");
CREATE INDEX "WellbeingLevelLabel_dimensionId_idx" ON "service_users"."WellbeingLevelLabel"("dimensionId");

ALTER TABLE "service_users"."WellbeingLevelLabel" ADD CONSTRAINT "WellbeingLevelLabel_dimensionId_fkey" FOREIGN KEY ("dimensionId") REFERENCES "service_users"."WellbeingDimension"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "service_users"."ServiceUserObservation" (
    "id" UUID NOT NULL,
    "serviceUserId" UUID NOT NULL,
    "observationTypeId" UUID NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL,
    "notes" TEXT,
    "numericValue" DECIMAL(12,4),
    "unit" TEXT,
    "payload" JSONB,
    "recordedByUserId" UUID,
    "recordedByEmployeeId" UUID,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdById" UUID,
    "updatedById" UUID,
    "deletedById" UUID,

    CONSTRAINT "ServiceUserObservation_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ServiceUserObservation_serviceUserId_idx" ON "service_users"."ServiceUserObservation"("serviceUserId");
CREATE INDEX "ServiceUserObservation_observationTypeId_idx" ON "service_users"."ServiceUserObservation"("observationTypeId");
CREATE INDEX "ServiceUserObservation_recordedAt_idx" ON "service_users"."ServiceUserObservation"("recordedAt");
CREATE INDEX "ServiceUserObservation_deletedAt_idx" ON "service_users"."ServiceUserObservation"("deletedAt");

ALTER TABLE "service_users"."ServiceUserObservation" ADD CONSTRAINT "ServiceUserObservation_serviceUserId_fkey" FOREIGN KEY ("serviceUserId") REFERENCES "service_users"."ServiceUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "service_users"."ServiceUserObservation" ADD CONSTRAINT "ServiceUserObservation_observationTypeId_fkey" FOREIGN KEY ("observationTypeId") REFERENCES "service_users"."ObservationType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "service_users"."ServiceUserObservation" ADD CONSTRAINT "ServiceUserObservation_recordedByUserId_fkey" FOREIGN KEY ("recordedByUserId") REFERENCES "identity"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "service_users"."ServiceUserObservation" ADD CONSTRAINT "ServiceUserObservation_recordedByEmployeeId_fkey" FOREIGN KEY ("recordedByEmployeeId") REFERENCES "employees"."Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "service_users"."ObservationRecordShare" (
    "observationId" UUID NOT NULL,
    "shareTargetId" UUID NOT NULL,

    CONSTRAINT "ObservationRecordShare_pkey" PRIMARY KEY ("observationId","shareTargetId")
);

ALTER TABLE "service_users"."ObservationRecordShare" ADD CONSTRAINT "ObservationRecordShare_observationId_fkey" FOREIGN KEY ("observationId") REFERENCES "service_users"."ServiceUserObservation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "service_users"."ObservationRecordShare" ADD CONSTRAINT "ObservationRecordShare_shareTargetId_fkey" FOREIGN KEY ("shareTargetId") REFERENCES "service_users"."ObservationShareTarget"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "service_users"."WellbeingObservationScore" (
    "id" UUID NOT NULL,
    "observationId" UUID NOT NULL,
    "dimensionId" UUID NOT NULL,
    "level" INTEGER NOT NULL,

    CONSTRAINT "WellbeingObservationScore_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WellbeingObservationScore_observationId_dimensionId_key" ON "service_users"."WellbeingObservationScore"("observationId", "dimensionId");
CREATE INDEX "WellbeingObservationScore_observationId_idx" ON "service_users"."WellbeingObservationScore"("observationId");

ALTER TABLE "service_users"."WellbeingObservationScore" ADD CONSTRAINT "WellbeingObservationScore_observationId_fkey" FOREIGN KEY ("observationId") REFERENCES "service_users"."ServiceUserObservation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "service_users"."WellbeingObservationScore" ADD CONSTRAINT "WellbeingObservationScore_dimensionId_fkey" FOREIGN KEY ("dimensionId") REFERENCES "service_users"."WellbeingDimension"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
