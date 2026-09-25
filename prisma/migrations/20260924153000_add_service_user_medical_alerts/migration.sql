-- CreateEnum
CREATE TYPE "service_users"."MedicalAlertCategory" AS ENUM (
  'CAPABILITIES',
  'GENERAL_ALERT',
  'COMMUNICATION',
  'DIABETES',
  'DIETARY',
  'PALLIATIVE',
  'BEHAVIOUR',
  'FALLS',
  'DOLS',
  'CHOKING',
  'COPD',
  'DNACPR',
  'RISK_LEVEL',
  'ALLERGIES',
  'CUSTOM'
);

-- CreateEnum
CREATE TYPE "service_users"."MedicalAlertSeverity" AS ENUM (
  'CRITICAL',
  'IMPORTANT',
  'INFO'
);

-- CreateTable
CREATE TABLE "service_users"."ServiceUserMedicalAlert" (
    "id" UUID NOT NULL,
    "serviceUserId" UUID NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "category" "service_users"."MedicalAlertCategory" NOT NULL DEFAULT 'CUSTOM',
    "severity" "service_users"."MedicalAlertSeverity" NOT NULL DEFAULT 'IMPORTANT',
    "description" TEXT NOT NULL DEFAULT '',
    "actionForCarer" TEXT NOT NULL DEFAULT '',
    "notes" TEXT NOT NULL DEFAULT '',
    "source" "service_users"."ServiceUserClinicalDataSource" NOT NULL DEFAULT 'MANUAL',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdById" UUID,
    "updatedById" UUID,
    "deletedById" UUID,

    CONSTRAINT "ServiceUserMedicalAlert_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ServiceUserMedicalAlert_serviceUserId_idx" ON "service_users"."ServiceUserMedicalAlert"("serviceUserId");

-- CreateIndex
CREATE INDEX "ServiceUserMedicalAlert_category_idx" ON "service_users"."ServiceUserMedicalAlert"("category");

-- CreateIndex
CREATE INDEX "ServiceUserMedicalAlert_severity_idx" ON "service_users"."ServiceUserMedicalAlert"("severity");

-- CreateIndex
CREATE INDEX "ServiceUserMedicalAlert_isActive_idx" ON "service_users"."ServiceUserMedicalAlert"("isActive");

-- CreateIndex
CREATE INDEX "ServiceUserMedicalAlert_deletedAt_idx" ON "service_users"."ServiceUserMedicalAlert"("deletedAt");

-- AddForeignKey
ALTER TABLE "service_users"."ServiceUserMedicalAlert" ADD CONSTRAINT "ServiceUserMedicalAlert_serviceUserId_fkey" FOREIGN KEY ("serviceUserId") REFERENCES "service_users"."ServiceUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
