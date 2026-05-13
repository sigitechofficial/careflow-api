-- CreateEnum
CREATE TYPE "service_users"."ServiceUserAbsenceType" AS ENUM ('PLANNED', 'UNPLANNED', 'NOT_APPLICABLE');

-- CreateTable
CREATE TABLE "service_users"."AbsenceReasonCatalog" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AbsenceReasonCatalog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AbsenceReasonCatalog_code_key" ON "service_users"."AbsenceReasonCatalog"("code");

-- CreateIndex
CREATE INDEX "AbsenceReasonCatalog_isActive_idx" ON "service_users"."AbsenceReasonCatalog"("isActive");

-- CreateTable
CREATE TABLE "service_users"."ServiceUserAbsence" (
    "id" UUID NOT NULL,
    "serviceUserId" UUID NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3),
    "startTime" TEXT,
    "endTime" TEXT,
    "absenceType" "service_users"."ServiceUserAbsenceType" NOT NULL DEFAULT 'NOT_APPLICABLE',
    "absenceReasonCatalogId" UUID NOT NULL,
    "notes" TEXT NOT NULL DEFAULT '',
    "contactInformation" TEXT NOT NULL DEFAULT '',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdById" UUID,
    "updatedById" UUID,
    "deletedById" UUID,

    CONSTRAINT "ServiceUserAbsence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ServiceUserAbsence_serviceUserId_idx" ON "service_users"."ServiceUserAbsence"("serviceUserId");

-- CreateIndex
CREATE INDEX "ServiceUserAbsence_deletedAt_idx" ON "service_users"."ServiceUserAbsence"("deletedAt");

-- AddForeignKey
ALTER TABLE "service_users"."ServiceUserAbsence" ADD CONSTRAINT "ServiceUserAbsence_serviceUserId_fkey" FOREIGN KEY ("serviceUserId") REFERENCES "service_users"."ServiceUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_users"."ServiceUserAbsence" ADD CONSTRAINT "ServiceUserAbsence_absenceReasonCatalogId_fkey" FOREIGN KEY ("absenceReasonCatalogId") REFERENCES "service_users"."AbsenceReasonCatalog"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
