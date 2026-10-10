-- AlterTable
ALTER TABLE "billing"."PayCardRule" ADD COLUMN     "supersededAt" TIMESTAMP(3),
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "billing"."PayCardVersion" (
    "id" UUID NOT NULL,
    "payCardId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "effectiveFrom" DATE NOT NULL,
    "changeNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" UUID,

    CONSTRAINT "PayCardVersion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PayCardVersion_payCardId_version_key" ON "billing"."PayCardVersion"("payCardId", "version");

-- CreateIndex
CREATE INDEX "PayCardRule_payCardId_version_idx" ON "billing"."PayCardRule"("payCardId", "version");

-- AddForeignKey
ALTER TABLE "billing"."PayCardVersion" ADD CONSTRAINT "PayCardVersion_payCardId_fkey" FOREIGN KEY ("payCardId") REFERENCES "billing"."PayCard"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Backfill: existing rules belong to their card's current version, and each card gets
-- a version-history row for that version (effective from the card's own start date).
UPDATE "billing"."PayCardRule" r
SET "version" = c."version"
FROM "billing"."PayCard" c
WHERE r."payCardId" = c."id";

INSERT INTO "billing"."PayCardVersion" ("id", "payCardId", "version", "effectiveFrom", "changeNote", "createdAt", "createdById")
SELECT gen_random_uuid(), c."id", c."version", c."effectiveFrom", NULL, c."createdAt", c."createdById"
FROM "billing"."PayCard" c;
