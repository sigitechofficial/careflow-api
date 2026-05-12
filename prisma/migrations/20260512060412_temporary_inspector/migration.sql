-- CreateTable
CREATE TABLE "employees"."TemporaryInspector" (
    "id" UUID NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "serviceUserKey" TEXT,
    "validFrom" TIMESTAMP(3) NOT NULL,
    "validTo" TIMESTAMP(3) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdById" UUID,
    "updatedById" UUID,

    CONSTRAINT "TemporaryInspector_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TemporaryInspector_username_key" ON "employees"."TemporaryInspector"("username");

-- CreateIndex
CREATE INDEX "TemporaryInspector_deletedAt_idx" ON "employees"."TemporaryInspector"("deletedAt");

-- CreateIndex
CREATE INDEX "TemporaryInspector_validTo_idx" ON "employees"."TemporaryInspector"("validTo");
