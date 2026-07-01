-- CreateTable
CREATE TABLE "service_users"."ServiceUserPortalAccount" (
    "id" UUID NOT NULL,
    "serviceUserId" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "isEnabled" BOOLEAN NOT NULL DEFAULT false,
    "refreshTokenHash" TEXT,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdById" UUID,
    "updatedById" UUID,

    CONSTRAINT "ServiceUserPortalAccount_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ServiceUserPortalAccount_serviceUserId_key" ON "service_users"."ServiceUserPortalAccount"("serviceUserId");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceUserPortalAccount_email_key" ON "service_users"."ServiceUserPortalAccount"("email");

-- CreateIndex
CREATE INDEX "ServiceUserPortalAccount_deletedAt_idx" ON "service_users"."ServiceUserPortalAccount"("deletedAt");

-- AddForeignKey
ALTER TABLE "service_users"."ServiceUserPortalAccount" ADD CONSTRAINT "ServiceUserPortalAccount_serviceUserId_fkey" FOREIGN KEY ("serviceUserId") REFERENCES "service_users"."ServiceUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;
