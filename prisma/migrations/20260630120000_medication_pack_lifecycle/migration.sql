-- Track E — pack cycle lifecycle (medication.md §35)
-- Adds pack lifecycle columns, the canonical MedicationPackMember link table,
-- and immutable contents snapshots captured at publish.

-- Enums
CREATE TYPE "service_users"."MedicationPackType" AS ENUM ('BLISTER', 'DOSSETTE', 'NOMAD', 'OTHER');
CREATE TYPE "service_users"."MedicationPackStatus" AS ENUM ('DRAFT', 'ACTIVE', 'SUPERSEDED', 'ENDED');
CREATE TYPE "service_users"."MedicationPackMemberStatus" AS ENUM ('ACTIVE', 'ENDED');

-- MedicationPack lifecycle columns
ALTER TABLE "service_users"."MedicationPack"
    ADD COLUMN "cycleNumber" INTEGER NOT NULL DEFAULT 1,
    ADD COLUMN "packType" "service_users"."MedicationPackType" NOT NULL DEFAULT 'BLISTER',
    ADD COLUMN "status" "service_users"."MedicationPackStatus" NOT NULL DEFAULT 'DRAFT',
    ADD COLUMN "roundLabel" TEXT,
    ADD COLUMN "pharmacyName" TEXT,
    ADD COLUMN "pharmacyPhone" TEXT,
    ADD COLUMN "gpName" TEXT,
    ADD COLUMN "gpSurgery" TEXT,
    ADD COLUMN "nhsNumber" TEXT,
    ADD COLUMN "publishedAt" TIMESTAMP(3),
    ADD COLUMN "publishedById" UUID,
    ADD COLUMN "supersededAt" TIMESTAMP(3),
    ADD COLUMN "supersededById" UUID,
    ADD COLUMN "supersededByPackId" UUID,
    ADD COLUMN "endedAt" TIMESTAMP(3),
    ADD COLUMN "endedById" UUID;

-- Existing packs predate the lifecycle; treat active ones as published/ACTIVE.
UPDATE "service_users"."MedicationPack"
    SET "status" = 'ACTIVE'
    WHERE "isActive" = true AND "deletedAt" IS NULL;

CREATE INDEX "MedicationPack_status_idx" ON "service_users"."MedicationPack"("status");

ALTER TABLE "service_users"."MedicationPack"
    ADD CONSTRAINT "MedicationPack_supersededByPackId_fkey"
    FOREIGN KEY ("supersededByPackId") REFERENCES "service_users"."MedicationPack"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- Canonical pack membership
CREATE TABLE "service_users"."MedicationPackMember" (
    "id" UUID NOT NULL,
    "medicationPackId" UUID NOT NULL,
    "serviceUserMedicationId" UUID NOT NULL,
    "status" "service_users"."MedicationPackMemberStatus" NOT NULL DEFAULT 'ACTIVE',
    "linkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "linkedById" UUID,
    "endedAt" TIMESTAMP(3),
    "endedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "MedicationPackMember_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MedicationPackMember_medicationPackId_serviceUserMedicationI_key" ON "service_users"."MedicationPackMember"("medicationPackId", "serviceUserMedicationId");
CREATE INDEX "MedicationPackMember_medicationPackId_idx" ON "service_users"."MedicationPackMember"("medicationPackId");
CREATE INDEX "MedicationPackMember_serviceUserMedicationId_idx" ON "service_users"."MedicationPackMember"("serviceUserMedicationId");
CREATE INDEX "MedicationPackMember_status_idx" ON "service_users"."MedicationPackMember"("status");
CREATE INDEX "MedicationPackMember_deletedAt_idx" ON "service_users"."MedicationPackMember"("deletedAt");

ALTER TABLE "service_users"."MedicationPackMember" ADD CONSTRAINT "MedicationPackMember_medicationPackId_fkey" FOREIGN KEY ("medicationPackId") REFERENCES "service_users"."MedicationPack"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "service_users"."MedicationPackMember" ADD CONSTRAINT "MedicationPackMember_serviceUserMedicationId_fkey" FOREIGN KEY ("serviceUserMedicationId") REFERENCES "service_users"."ServiceUserMedication"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Backfill members from the existing denormalized medicationPackId cache
INSERT INTO "service_users"."MedicationPackMember" ("id", "medicationPackId", "serviceUserMedicationId", "status", "linkedAt", "createdAt", "updatedAt")
SELECT gen_random_uuid(), m."medicationPackId", m."id", 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "service_users"."ServiceUserMedication" m
WHERE m."medicationPackId" IS NOT NULL AND m."deletedAt" IS NULL;

-- Immutable contents snapshot captured at publish
CREATE TABLE "service_users"."MedicationPackContentsSnapshot" (
    "id" UUID NOT NULL,
    "medicationPackId" UUID NOT NULL,
    "cycleNumber" INTEGER NOT NULL,
    "packName" TEXT NOT NULL,
    "packType" "service_users"."MedicationPackType" NOT NULL,
    "pharmacyName" TEXT,
    "pharmacyPhone" TEXT,
    "gpName" TEXT,
    "gpSurgery" TEXT,
    "nhsNumber" TEXT,
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MedicationPackContentsSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "MedicationPackContentsSnapshot_medicationPackId_idx" ON "service_users"."MedicationPackContentsSnapshot"("medicationPackId");

ALTER TABLE "service_users"."MedicationPackContentsSnapshot" ADD CONSTRAINT "MedicationPackContentsSnapshot_medicationPackId_fkey" FOREIGN KEY ("medicationPackId") REFERENCES "service_users"."MedicationPack"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "service_users"."MedicationPackContentsSnapshotLine" (
    "id" UUID NOT NULL,
    "snapshotId" UUID NOT NULL,
    "serviceUserMedicationId" UUID,
    "medicationName" TEXT NOT NULL,
    "strength" TEXT,
    "dose" TEXT,
    "routeName" TEXT,
    "instructions" TEXT,
    "roundLabels" TEXT,
    "tabletDescription" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MedicationPackContentsSnapshotLine_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "MedicationPackContentsSnapshotLine_snapshotId_idx" ON "service_users"."MedicationPackContentsSnapshotLine"("snapshotId");

ALTER TABLE "service_users"."MedicationPackContentsSnapshotLine" ADD CONSTRAINT "MedicationPackContentsSnapshotLine_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "service_users"."MedicationPackContentsSnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;
