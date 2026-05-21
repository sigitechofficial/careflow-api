-- CreateEnum
CREATE TYPE "service_users"."FlashMessageStatus" AS ENUM ('ACTIVE', 'EXPIRED', 'CLEARED', 'ARCHIVED');

-- CreateTable
CREATE TABLE "service_users"."ServiceUserFlashMessage" (
    "id" UUID NOT NULL,
    "serviceUserId" UUID NOT NULL,
    "message" TEXT NOT NULL,
    "displayUntil" TIMESTAMP(3) NOT NULL,
    "status" "service_users"."FlashMessageStatus" NOT NULL DEFAULT 'ACTIVE',
    "isCurrent" BOOLEAN NOT NULL DEFAULT true,
    "clearedAt" TIMESTAMP(3),
    "clearedById" UUID,
    "clearReason" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdById" UUID,
    "updatedById" UUID,
    "deletedById" UUID,

    CONSTRAINT "ServiceUserFlashMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ServiceUserFlashMessage_serviceUserId_idx" ON "service_users"."ServiceUserFlashMessage"("serviceUserId");

-- CreateIndex
CREATE INDEX "ServiceUserFlashMessage_status_idx" ON "service_users"."ServiceUserFlashMessage"("status");

-- CreateIndex
CREATE INDEX "ServiceUserFlashMessage_displayUntil_idx" ON "service_users"."ServiceUserFlashMessage"("displayUntil");

-- CreateIndex
CREATE INDEX "ServiceUserFlashMessage_isCurrent_idx" ON "service_users"."ServiceUserFlashMessage"("isCurrent");

-- CreateIndex
CREATE INDEX "ServiceUserFlashMessage_createdAt_idx" ON "service_users"."ServiceUserFlashMessage"("createdAt");

-- CreateIndex
CREATE INDEX "ServiceUserFlashMessage_deletedAt_idx" ON "service_users"."ServiceUserFlashMessage"("deletedAt");

-- AddForeignKey
ALTER TABLE "service_users"."ServiceUserFlashMessage" ADD CONSTRAINT "ServiceUserFlashMessage_serviceUserId_fkey" FOREIGN KEY ("serviceUserId") REFERENCES "service_users"."ServiceUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_users"."ServiceUserFlashMessage" ADD CONSTRAINT "ServiceUserFlashMessage_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "identity"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_users"."ServiceUserFlashMessage" ADD CONSTRAINT "ServiceUserFlashMessage_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "identity"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_users"."ServiceUserFlashMessage" ADD CONSTRAINT "ServiceUserFlashMessage_clearedById_fkey" FOREIGN KEY ("clearedById") REFERENCES "identity"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_users"."ServiceUserFlashMessage" ADD CONSTRAINT "ServiceUserFlashMessage_deletedById_fkey" FOREIGN KEY ("deletedById") REFERENCES "identity"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
