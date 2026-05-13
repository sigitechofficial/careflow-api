-- CreateTable
CREATE TABLE "service_users"."ServiceUserInventoryItem" (
    "id" UUID NOT NULL,
    "serviceUserId" UUID NOT NULL,
    "itemName" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "itemValue" TEXT,
    "description" TEXT NOT NULL,
    "location" TEXT NOT NULL,
    "itemPhotoUrl" TEXT,
    "dateDeposited" TIMESTAMP(3) NOT NULL,
    "witnessSignatureDataUrl" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdById" UUID,
    "updatedById" UUID,
    "deletedById" UUID,

    CONSTRAINT "ServiceUserInventoryItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ServiceUserInventoryItem_serviceUserId_idx" ON "service_users"."ServiceUserInventoryItem"("serviceUserId");

-- CreateIndex
CREATE INDEX "ServiceUserInventoryItem_deletedAt_idx" ON "service_users"."ServiceUserInventoryItem"("deletedAt");

-- AddForeignKey
ALTER TABLE "service_users"."ServiceUserInventoryItem" ADD CONSTRAINT "ServiceUserInventoryItem_serviceUserId_fkey" FOREIGN KEY ("serviceUserId") REFERENCES "service_users"."ServiceUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
