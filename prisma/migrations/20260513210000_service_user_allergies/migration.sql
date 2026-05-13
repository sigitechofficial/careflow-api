-- CreateTable
CREATE TABLE "service_users"."AllergyCatalog" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AllergyCatalog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AllergyCatalog_code_key" ON "service_users"."AllergyCatalog"("code");

-- CreateIndex
CREATE INDEX "AllergyCatalog_isActive_idx" ON "service_users"."AllergyCatalog"("isActive");

-- CreateTable
CREATE TABLE "service_users"."ServiceUserAllergy" (
    "id" UUID NOT NULL,
    "serviceUserId" UUID NOT NULL,
    "allergyCatalogId" UUID,
    "allergyName" TEXT NOT NULL,
    "comment" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdById" UUID,
    "updatedById" UUID,
    "deletedById" UUID,

    CONSTRAINT "ServiceUserAllergy_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ServiceUserAllergy_serviceUserId_idx" ON "service_users"."ServiceUserAllergy"("serviceUserId");

-- CreateIndex
CREATE INDEX "ServiceUserAllergy_deletedAt_idx" ON "service_users"."ServiceUserAllergy"("deletedAt");

-- AddForeignKey
ALTER TABLE "service_users"."ServiceUserAllergy" ADD CONSTRAINT "ServiceUserAllergy_serviceUserId_fkey" FOREIGN KEY ("serviceUserId") REFERENCES "service_users"."ServiceUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_users"."ServiceUserAllergy" ADD CONSTRAINT "ServiceUserAllergy_allergyCatalogId_fkey" FOREIGN KEY ("allergyCatalogId") REFERENCES "service_users"."AllergyCatalog"("id") ON DELETE SET NULL ON UPDATE CASCADE;
