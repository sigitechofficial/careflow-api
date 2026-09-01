-- CreateTable
CREATE TABLE "scheduling"."ServiceUserArea" (
    "id" UUID NOT NULL,
    "scheduleAreaId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdById" UUID,
    "updatedById" UUID,
    "deletedById" UUID,

    CONSTRAINT "ServiceUserArea_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scheduling"."ServiceUserAreaPostcode" (
    "id" UUID NOT NULL,
    "serviceUserAreaId" UUID NOT NULL,
    "postcode" TEXT NOT NULL,
    "normalizedPostcode" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServiceUserAreaPostcode_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "service_users"."ServiceUser" ADD COLUMN "serviceUserAreaId" UUID;

-- CreateIndex
CREATE INDEX "ServiceUserArea_deletedAt_idx" ON "scheduling"."ServiceUserArea"("deletedAt");

-- CreateIndex
CREATE INDEX "ServiceUserArea_isActive_idx" ON "scheduling"."ServiceUserArea"("isActive");

-- CreateIndex
CREATE INDEX "ServiceUserArea_scheduleAreaId_idx" ON "scheduling"."ServiceUserArea"("scheduleAreaId");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceUserArea_scheduleAreaId_code_key" ON "scheduling"."ServiceUserArea"("scheduleAreaId", "code");

-- CreateIndex
CREATE INDEX "ServiceUserAreaPostcode_serviceUserAreaId_idx" ON "scheduling"."ServiceUserAreaPostcode"("serviceUserAreaId");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceUserAreaPostcode_normalizedPostcode_key" ON "scheduling"."ServiceUserAreaPostcode"("normalizedPostcode");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceUserAreaPostcode_serviceUserAreaId_normalizedPostcode_key" ON "scheduling"."ServiceUserAreaPostcode"("serviceUserAreaId", "normalizedPostcode");

-- CreateIndex
CREATE INDEX "ServiceUser_serviceUserAreaId_idx" ON "service_users"."ServiceUser"("serviceUserAreaId");

-- AddForeignKey
ALTER TABLE "scheduling"."ServiceUserArea" ADD CONSTRAINT "ServiceUserArea_scheduleAreaId_fkey" FOREIGN KEY ("scheduleAreaId") REFERENCES "scheduling"."ScheduleArea"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scheduling"."ServiceUserArea" ADD CONSTRAINT "ServiceUserArea_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "identity"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scheduling"."ServiceUserArea" ADD CONSTRAINT "ServiceUserArea_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "identity"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scheduling"."ServiceUserArea" ADD CONSTRAINT "ServiceUserArea_deletedById_fkey" FOREIGN KEY ("deletedById") REFERENCES "identity"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scheduling"."ServiceUserAreaPostcode" ADD CONSTRAINT "ServiceUserAreaPostcode_serviceUserAreaId_fkey" FOREIGN KEY ("serviceUserAreaId") REFERENCES "scheduling"."ServiceUserArea"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_users"."ServiceUser" ADD CONSTRAINT "ServiceUser_serviceUserAreaId_fkey" FOREIGN KEY ("serviceUserAreaId") REFERENCES "scheduling"."ServiceUserArea"("id") ON DELETE SET NULL ON UPDATE CASCADE;
