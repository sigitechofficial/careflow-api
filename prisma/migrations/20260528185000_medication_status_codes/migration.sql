-- CreateEnum
CREATE TYPE "service_users"."MedicationStatusCodeCategory" AS ENUM ('SUCCESS', 'EXCEPTION', 'WARNING', 'INFORMATION', 'NEUTRAL', 'CRITICAL', 'PENDING');

-- CreateEnum
CREATE TYPE "service_users"."MedicationStatusCodeFieldRequirement" AS ENUM ('NOT_REQUIRED', 'OPTIONAL', 'REQUIRED');

-- CreateTable
CREATE TABLE "service_users"."MedicationStatusCode" (
    "id" UUID NOT NULL,
    "code" VARCHAR(16) NOT NULL,
    "label" TEXT NOT NULL,
    "color" VARCHAR(7) NOT NULL,
    "textColor" VARCHAR(7) NOT NULL,
    "category" "service_users"."MedicationStatusCodeCategory" NOT NULL,
    "administrationStatus" "service_users"."MedicationAdministrationStatus" NOT NULL DEFAULT 'PENDING',
    "reasonRequirement" "service_users"."MedicationStatusCodeFieldRequirement" NOT NULL DEFAULT 'NOT_REQUIRED',
    "managerReviewRequirement" "service_users"."MedicationStatusCodeFieldRequirement" NOT NULL DEFAULT 'NOT_REQUIRED',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "MedicationStatusCode_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MedicationStatusCode_code_key" ON "service_users"."MedicationStatusCode"("code");

-- CreateIndex
CREATE INDEX "MedicationStatusCode_deletedAt_idx" ON "service_users"."MedicationStatusCode"("deletedAt");

-- CreateIndex
CREATE INDEX "MedicationStatusCode_isActive_idx" ON "service_users"."MedicationStatusCode"("isActive");

-- CreateIndex
CREATE INDEX "MedicationStatusCode_sortOrder_idx" ON "service_users"."MedicationStatusCode"("sortOrder");

-- CreateIndex
CREATE INDEX "MedicationStatusCode_administrationStatus_idx" ON "service_users"."MedicationStatusCode"("administrationStatus");
