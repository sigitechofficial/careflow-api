-- CreateEnum
CREATE TYPE "service_users"."MedicationKind" AS ENUM ('REGULAR', 'PRN');

-- CreateEnum
CREATE TYPE "service_users"."MedicationRecordStatus" AS ENUM ('ACTIVE', 'ENDED', 'PAUSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "service_users"."MedicationAdministrationStatus" AS ENUM ('GIVEN', 'NOT_GIVEN', 'REFUSED', 'MISSED', 'HELD', 'CANCELLED', 'PENDING');

-- CreateEnum
CREATE TYPE "service_users"."MedicationStockMovementType" AS ENUM ('ADDED', 'USED', 'ADJUSTED', 'WASTED');

-- Medication-only migration (unrelated index/column churn removed so shadow DB validates).

-- CreateTable
CREATE TABLE "service_users"."MedicationType" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "MedicationType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_users"."MedicationRoute" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "MedicationRoute_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_users"."MedicationCategory" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "MedicationCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_users"."MedicationFrequency" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT,
    "timesPerDay" INTEGER,
    "intervalHours" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "MedicationFrequency_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_users"."MedicationAdministrationRound" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "time" VARCHAR(5) NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "MedicationAdministrationRound_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_users"."MedicationNotGivenReason" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "MedicationNotGivenReason_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_users"."MedicationAllergy" (
    "id" UUID NOT NULL,
    "serviceUserId" UUID NOT NULL,
    "allergyName" TEXT NOT NULL,
    "reaction" TEXT,
    "severity" TEXT,
    "notes" TEXT,
    "recordedById" UUID,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdById" UUID,
    "updatedById" UUID,
    "deletedById" UUID,

    CONSTRAINT "MedicationAllergy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_users"."MedicationPack" (
    "id" UUID NOT NULL,
    "serviceUserId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdById" UUID,
    "updatedById" UUID,
    "deletedById" UUID,

    CONSTRAINT "MedicationPack_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_users"."MedicationPackItem" (
    "id" UUID NOT NULL,
    "medicationPackId" UUID NOT NULL,
    "medicationName" TEXT NOT NULL,
    "strength" TEXT,
    "notes" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "MedicationPackItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_users"."ServiceUserMedication" (
    "id" UUID NOT NULL,
    "serviceUserId" UUID NOT NULL,
    "medicationPackId" UUID,
    "medicationName" TEXT NOT NULL,
    "dose" TEXT,
    "strength" TEXT,
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "medicationTypeId" UUID,
    "routeId" UUID,
    "categoryId" UUID,
    "frequencyId" UUID,
    "frequencyText" TEXT,
    "instructions" TEXT,
    "notes" TEXT,
    "isControlledMedication" BOOLEAN NOT NULL DEFAULT false,
    "medicationKind" "service_users"."MedicationKind" NOT NULL,
    "status" "service_users"."MedicationRecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdById" UUID,
    "updatedById" UUID,
    "deletedById" UUID,

    CONSTRAINT "ServiceUserMedication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_users"."MedicationSchedule" (
    "id" UUID NOT NULL,
    "serviceUserMedicationId" UUID NOT NULL,
    "roundId" UUID,
    "dueTime" VARCHAR(5),
    "dueVisitName" TEXT,
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "frequencyId" UUID,
    "frequencyText" TEXT,
    "daysOfWeek" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "instructions" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdById" UUID,
    "updatedById" UUID,
    "deletedById" UUID,

    CONSTRAINT "MedicationSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_users"."MedicationAdministrationEvent" (
    "id" UUID NOT NULL,
    "serviceUserId" UUID NOT NULL,
    "serviceUserMedicationId" UUID NOT NULL,
    "medicationScheduleId" UUID,
    "roundId" UUID,
    "administeredById" UUID,
    "scheduledDateTime" TIMESTAMP(3),
    "actualDateTime" TIMESTAMP(3),
    "status" "service_users"."MedicationAdministrationStatus" NOT NULL,
    "notGivenReasonId" UUID,
    "reason" TEXT,
    "notes" TEXT,
    "doseGiven" TEXT,
    "routeId" UUID,
    "visitId" UUID,
    "isPrn" BOOLEAN NOT NULL DEFAULT false,
    "prnReason" TEXT,
    "prnOutcome" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdById" UUID,
    "updatedById" UUID,
    "deletedById" UUID,

    CONSTRAINT "MedicationAdministrationEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_users"."MedicationSupportProfile" (
    "id" UUID NOT NULL,
    "serviceUserId" UUID NOT NULL,
    "selfAdministersMedication" BOOLEAN NOT NULL DEFAULT false,
    "requiresPrompting" BOOLEAN NOT NULL DEFAULT false,
    "requiresSupervision" BOOLEAN NOT NULL DEFAULT false,
    "requiresCarerAdministration" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdById" UUID,
    "updatedById" UUID,
    "deletedById" UUID,

    CONSTRAINT "MedicationSupportProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_users"."MedicationReview" (
    "id" UUID NOT NULL,
    "serviceUserId" UUID NOT NULL,
    "reviewedById" UUID,
    "reviewDate" TIMESTAMP(3) NOT NULL,
    "purpose" TEXT,
    "outcome" TEXT,
    "notes" TEXT,
    "nextReviewDate" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdById" UUID,
    "updatedById" UUID,
    "deletedById" UUID,

    CONSTRAINT "MedicationReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_users"."MedicationStockRecord" (
    "id" UUID NOT NULL,
    "serviceUserMedicationId" UUID NOT NULL,
    "quantity" DECIMAL(12,2),
    "unit" TEXT,
    "movementType" "service_users"."MedicationStockMovementType" NOT NULL,
    "movementDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,
    "recordedById" UUID,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "MedicationStockRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MedicationType_code_key" ON "service_users"."MedicationType"("code");

-- CreateIndex
CREATE INDEX "MedicationType_deletedAt_idx" ON "service_users"."MedicationType"("deletedAt");

-- CreateIndex
CREATE INDEX "MedicationType_isActive_idx" ON "service_users"."MedicationType"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "MedicationRoute_code_key" ON "service_users"."MedicationRoute"("code");

-- CreateIndex
CREATE INDEX "MedicationRoute_deletedAt_idx" ON "service_users"."MedicationRoute"("deletedAt");

-- CreateIndex
CREATE INDEX "MedicationRoute_isActive_idx" ON "service_users"."MedicationRoute"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "MedicationCategory_code_key" ON "service_users"."MedicationCategory"("code");

-- CreateIndex
CREATE INDEX "MedicationCategory_deletedAt_idx" ON "service_users"."MedicationCategory"("deletedAt");

-- CreateIndex
CREATE INDEX "MedicationCategory_isActive_idx" ON "service_users"."MedicationCategory"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "MedicationFrequency_code_key" ON "service_users"."MedicationFrequency"("code");

-- CreateIndex
CREATE INDEX "MedicationFrequency_deletedAt_idx" ON "service_users"."MedicationFrequency"("deletedAt");

-- CreateIndex
CREATE INDEX "MedicationFrequency_isActive_idx" ON "service_users"."MedicationFrequency"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "MedicationAdministrationRound_code_key" ON "service_users"."MedicationAdministrationRound"("code");

-- CreateIndex
CREATE INDEX "MedicationAdministrationRound_deletedAt_idx" ON "service_users"."MedicationAdministrationRound"("deletedAt");

-- CreateIndex
CREATE INDEX "MedicationAdministrationRound_isActive_idx" ON "service_users"."MedicationAdministrationRound"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "MedicationNotGivenReason_code_key" ON "service_users"."MedicationNotGivenReason"("code");

-- CreateIndex
CREATE INDEX "MedicationNotGivenReason_deletedAt_idx" ON "service_users"."MedicationNotGivenReason"("deletedAt");

-- CreateIndex
CREATE INDEX "MedicationNotGivenReason_isActive_idx" ON "service_users"."MedicationNotGivenReason"("isActive");

-- CreateIndex
CREATE INDEX "MedicationAllergy_serviceUserId_idx" ON "service_users"."MedicationAllergy"("serviceUserId");

-- CreateIndex
CREATE INDEX "MedicationAllergy_deletedAt_idx" ON "service_users"."MedicationAllergy"("deletedAt");

-- CreateIndex
CREATE INDEX "MedicationPack_serviceUserId_idx" ON "service_users"."MedicationPack"("serviceUserId");

-- CreateIndex
CREATE INDEX "MedicationPack_deletedAt_idx" ON "service_users"."MedicationPack"("deletedAt");

-- CreateIndex
CREATE INDEX "MedicationPackItem_medicationPackId_idx" ON "service_users"."MedicationPackItem"("medicationPackId");

-- CreateIndex
CREATE INDEX "MedicationPackItem_deletedAt_idx" ON "service_users"."MedicationPackItem"("deletedAt");

-- CreateIndex
CREATE INDEX "ServiceUserMedication_serviceUserId_idx" ON "service_users"."ServiceUserMedication"("serviceUserId");

-- CreateIndex
CREATE INDEX "ServiceUserMedication_medicationPackId_idx" ON "service_users"."ServiceUserMedication"("medicationPackId");

-- CreateIndex
CREATE INDEX "ServiceUserMedication_deletedAt_idx" ON "service_users"."ServiceUserMedication"("deletedAt");

-- CreateIndex
CREATE INDEX "ServiceUserMedication_medicationKind_idx" ON "service_users"."ServiceUserMedication"("medicationKind");

-- CreateIndex
CREATE INDEX "ServiceUserMedication_status_idx" ON "service_users"."ServiceUserMedication"("status");

-- CreateIndex
CREATE INDEX "MedicationSchedule_serviceUserMedicationId_idx" ON "service_users"."MedicationSchedule"("serviceUserMedicationId");

-- CreateIndex
CREATE INDEX "MedicationSchedule_deletedAt_idx" ON "service_users"."MedicationSchedule"("deletedAt");

-- CreateIndex
CREATE INDEX "MedicationAdministrationEvent_serviceUserId_idx" ON "service_users"."MedicationAdministrationEvent"("serviceUserId");

-- CreateIndex
CREATE INDEX "MedicationAdministrationEvent_serviceUserMedicationId_idx" ON "service_users"."MedicationAdministrationEvent"("serviceUserMedicationId");

-- CreateIndex
CREATE INDEX "MedicationAdministrationEvent_scheduledDateTime_idx" ON "service_users"."MedicationAdministrationEvent"("scheduledDateTime");

-- CreateIndex
CREATE INDEX "MedicationAdministrationEvent_actualDateTime_idx" ON "service_users"."MedicationAdministrationEvent"("actualDateTime");

-- CreateIndex
CREATE INDEX "MedicationAdministrationEvent_status_idx" ON "service_users"."MedicationAdministrationEvent"("status");

-- CreateIndex
CREATE INDEX "MedicationAdministrationEvent_deletedAt_idx" ON "service_users"."MedicationAdministrationEvent"("deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "MedicationSupportProfile_serviceUserId_key" ON "service_users"."MedicationSupportProfile"("serviceUserId");

-- CreateIndex
CREATE INDEX "MedicationSupportProfile_deletedAt_idx" ON "service_users"."MedicationSupportProfile"("deletedAt");

-- CreateIndex
CREATE INDEX "MedicationReview_serviceUserId_idx" ON "service_users"."MedicationReview"("serviceUserId");

-- CreateIndex
CREATE INDEX "MedicationReview_reviewDate_idx" ON "service_users"."MedicationReview"("reviewDate");

-- CreateIndex
CREATE INDEX "MedicationReview_deletedAt_idx" ON "service_users"."MedicationReview"("deletedAt");

-- CreateIndex
CREATE INDEX "MedicationStockRecord_serviceUserMedicationId_idx" ON "service_users"."MedicationStockRecord"("serviceUserMedicationId");

-- CreateIndex
CREATE INDEX "MedicationStockRecord_movementDate_idx" ON "service_users"."MedicationStockRecord"("movementDate");

-- CreateIndex
CREATE INDEX "MedicationStockRecord_deletedAt_idx" ON "service_users"."MedicationStockRecord"("deletedAt");

-- AddForeignKey
ALTER TABLE "service_users"."MedicationAllergy" ADD CONSTRAINT "MedicationAllergy_serviceUserId_fkey" FOREIGN KEY ("serviceUserId") REFERENCES "service_users"."ServiceUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_users"."MedicationPack" ADD CONSTRAINT "MedicationPack_serviceUserId_fkey" FOREIGN KEY ("serviceUserId") REFERENCES "service_users"."ServiceUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_users"."MedicationPackItem" ADD CONSTRAINT "MedicationPackItem_medicationPackId_fkey" FOREIGN KEY ("medicationPackId") REFERENCES "service_users"."MedicationPack"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_users"."ServiceUserMedication" ADD CONSTRAINT "ServiceUserMedication_serviceUserId_fkey" FOREIGN KEY ("serviceUserId") REFERENCES "service_users"."ServiceUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_users"."ServiceUserMedication" ADD CONSTRAINT "ServiceUserMedication_medicationPackId_fkey" FOREIGN KEY ("medicationPackId") REFERENCES "service_users"."MedicationPack"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_users"."ServiceUserMedication" ADD CONSTRAINT "ServiceUserMedication_medicationTypeId_fkey" FOREIGN KEY ("medicationTypeId") REFERENCES "service_users"."MedicationType"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_users"."ServiceUserMedication" ADD CONSTRAINT "ServiceUserMedication_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "service_users"."MedicationRoute"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_users"."ServiceUserMedication" ADD CONSTRAINT "ServiceUserMedication_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "service_users"."MedicationCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_users"."ServiceUserMedication" ADD CONSTRAINT "ServiceUserMedication_frequencyId_fkey" FOREIGN KEY ("frequencyId") REFERENCES "service_users"."MedicationFrequency"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_users"."MedicationSchedule" ADD CONSTRAINT "MedicationSchedule_serviceUserMedicationId_fkey" FOREIGN KEY ("serviceUserMedicationId") REFERENCES "service_users"."ServiceUserMedication"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_users"."MedicationSchedule" ADD CONSTRAINT "MedicationSchedule_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "service_users"."MedicationAdministrationRound"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_users"."MedicationSchedule" ADD CONSTRAINT "MedicationSchedule_frequencyId_fkey" FOREIGN KEY ("frequencyId") REFERENCES "service_users"."MedicationFrequency"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_users"."MedicationAdministrationEvent" ADD CONSTRAINT "MedicationAdministrationEvent_serviceUserId_fkey" FOREIGN KEY ("serviceUserId") REFERENCES "service_users"."ServiceUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_users"."MedicationAdministrationEvent" ADD CONSTRAINT "MedicationAdministrationEvent_serviceUserMedicationId_fkey" FOREIGN KEY ("serviceUserMedicationId") REFERENCES "service_users"."ServiceUserMedication"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_users"."MedicationAdministrationEvent" ADD CONSTRAINT "MedicationAdministrationEvent_medicationScheduleId_fkey" FOREIGN KEY ("medicationScheduleId") REFERENCES "service_users"."MedicationSchedule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_users"."MedicationAdministrationEvent" ADD CONSTRAINT "MedicationAdministrationEvent_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "service_users"."MedicationAdministrationRound"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_users"."MedicationAdministrationEvent" ADD CONSTRAINT "MedicationAdministrationEvent_administeredById_fkey" FOREIGN KEY ("administeredById") REFERENCES "employees"."Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_users"."MedicationAdministrationEvent" ADD CONSTRAINT "MedicationAdministrationEvent_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "service_users"."MedicationRoute"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_users"."MedicationAdministrationEvent" ADD CONSTRAINT "MedicationAdministrationEvent_notGivenReasonId_fkey" FOREIGN KEY ("notGivenReasonId") REFERENCES "service_users"."MedicationNotGivenReason"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_users"."MedicationSupportProfile" ADD CONSTRAINT "MedicationSupportProfile_serviceUserId_fkey" FOREIGN KEY ("serviceUserId") REFERENCES "service_users"."ServiceUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_users"."MedicationReview" ADD CONSTRAINT "MedicationReview_serviceUserId_fkey" FOREIGN KEY ("serviceUserId") REFERENCES "service_users"."ServiceUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_users"."MedicationReview" ADD CONSTRAINT "MedicationReview_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "employees"."Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_users"."MedicationStockRecord" ADD CONSTRAINT "MedicationStockRecord_serviceUserMedicationId_fkey" FOREIGN KEY ("serviceUserMedicationId") REFERENCES "service_users"."ServiceUserMedication"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_users"."MedicationStockRecord" ADD CONSTRAINT "MedicationStockRecord_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "employees"."Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "service_users"."ServiceUserDomCareBlockedCarer_serviceUserDomCareId_employeeId_" RENAME TO "ServiceUserDomCareBlockedCarer_serviceUserDomCareId_employe_key";

-- RenameIndex
ALTER INDEX "service_users"."ServiceUserDomCarePreferredCarer_serviceUserDomCareId_employeeI" RENAME TO "ServiceUserDomCarePreferredCarer_serviceUserDomCareId_emplo_key";
