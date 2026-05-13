-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "service_users";

-- AlterTable
ALTER TABLE "employees"."ComplianceReminder" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "employees"."ComplianceRequirement" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "employees"."ComplianceVerification" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "employees"."EmployeeComplianceDocument" ALTER COLUMN "id" DROP DEFAULT;

-- CreateTable
CREATE TABLE "service_users"."ServiceUserStatus" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServiceUserStatus_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_users"."ServiceUserTitle" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServiceUserTitle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_users"."ServiceUserGender" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServiceUserGender_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_users"."ServiceUserMaritalStatus" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServiceUserMaritalStatus_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_users"."ServiceUserCareType" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServiceUserCareType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_users"."ServiceUserFundingType" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServiceUserFundingType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_users"."ServiceUserRiskLevel" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "color" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServiceUserRiskLevel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_users"."RelationshipType" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RelationshipType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_users"."ServiceUser" (
    "id" UUID NOT NULL,
    "serviceUserNumber" TEXT,
    "residentId" TEXT,
    "residentGuid" TEXT,
    "firstName" TEXT NOT NULL,
    "middleName" TEXT,
    "lastName" TEXT NOT NULL,
    "preferredName" TEXT,
    "dateOfBirth" TIMESTAMP(3),
    "titleId" UUID,
    "genderId" UUID,
    "maritalStatusId" UUID,
    "statusId" UUID,
    "careTypeId" UUID,
    "fundingTypeId" UUID,
    "riskLevelId" UUID,
    "profilePhotoUrl" TEXT,
    "nhsNumber" TEXT,
    "nationalInsuranceNumber" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "mobile" TEXT,
    "serviceStartDate" TIMESTAMP(3),
    "serviceEndDate" TIMESTAMP(3),
    "locationId" UUID,
    "keyWorkerId" UUID,
    "namedNurseId" UUID,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdById" UUID,
    "updatedById" UUID,
    "deletedById" UUID,

    CONSTRAINT "ServiceUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_users"."ServiceUserContact" (
    "id" UUID NOT NULL,
    "serviceUserId" UUID NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT,
    "relationshipTypeId" UUID,
    "phone" TEXT,
    "mobile" TEXT,
    "email" TEXT,
    "address" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "isEmergencyContact" BOOLEAN NOT NULL DEFAULT false,
    "canReceiveUpdates" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdById" UUID,
    "updatedById" UUID,
    "deletedById" UUID,

    CONSTRAINT "ServiceUserContact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_users"."ServiceUserAddress" (
    "id" UUID NOT NULL,
    "serviceUserId" UUID NOT NULL,
    "addressLine1" TEXT,
    "addressLine2" TEXT,
    "town" TEXT,
    "county" TEXT,
    "country" TEXT,
    "postcode" TEXT,
    "latitude" DECIMAL(10,7),
    "longitude" DECIMAL(10,7),
    "accessInstructions" TEXT,
    "keySafeNumber" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdById" UUID,
    "updatedById" UUID,
    "deletedById" UUID,

    CONSTRAINT "ServiceUserAddress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_users"."ServiceUserReference" (
    "id" UUID NOT NULL,
    "serviceUserId" UUID NOT NULL,
    "referenceType" TEXT NOT NULL,
    "referenceValue" TEXT NOT NULL,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "ServiceUserReference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_users"."ServiceUserAssignment" (
    "id" UUID NOT NULL,
    "serviceUserId" UUID NOT NULL,
    "keyWorkerId" UUID,
    "namedNurseId" UUID,
    "locationId" UUID,
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdById" UUID,
    "updatedById" UUID,
    "deletedById" UUID,

    CONSTRAINT "ServiceUserAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_users"."ServiceUserPhoto" (
    "id" UUID NOT NULL,
    "serviceUserId" UUID NOT NULL,
    "fileName" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "mimeType" TEXT NOT NULL,
    "uploadedById" UUID,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isProfilePhoto" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "ServiceUserPhoto_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ServiceUserStatus_code_key" ON "service_users"."ServiceUserStatus"("code");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceUserTitle_code_key" ON "service_users"."ServiceUserTitle"("code");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceUserGender_code_key" ON "service_users"."ServiceUserGender"("code");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceUserMaritalStatus_code_key" ON "service_users"."ServiceUserMaritalStatus"("code");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceUserCareType_code_key" ON "service_users"."ServiceUserCareType"("code");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceUserFundingType_code_key" ON "service_users"."ServiceUserFundingType"("code");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceUserRiskLevel_code_key" ON "service_users"."ServiceUserRiskLevel"("code");

-- CreateIndex
CREATE UNIQUE INDEX "RelationshipType_code_key" ON "service_users"."RelationshipType"("code");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceUser_serviceUserNumber_key" ON "service_users"."ServiceUser"("serviceUserNumber");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceUser_residentGuid_key" ON "service_users"."ServiceUser"("residentGuid");

-- CreateIndex
CREATE INDEX "ServiceUser_deletedAt_idx" ON "service_users"."ServiceUser"("deletedAt");

-- CreateIndex
CREATE INDEX "ServiceUser_statusId_idx" ON "service_users"."ServiceUser"("statusId");

-- CreateIndex
CREATE INDEX "ServiceUser_careTypeId_idx" ON "service_users"."ServiceUser"("careTypeId");

-- CreateIndex
CREATE INDEX "ServiceUser_fundingTypeId_idx" ON "service_users"."ServiceUser"("fundingTypeId");

-- CreateIndex
CREATE INDEX "ServiceUser_riskLevelId_idx" ON "service_users"."ServiceUser"("riskLevelId");

-- CreateIndex
CREATE INDEX "ServiceUser_locationId_idx" ON "service_users"."ServiceUser"("locationId");

-- CreateIndex
CREATE INDEX "ServiceUser_keyWorkerId_idx" ON "service_users"."ServiceUser"("keyWorkerId");

-- CreateIndex
CREATE INDEX "ServiceUser_namedNurseId_idx" ON "service_users"."ServiceUser"("namedNurseId");

-- CreateIndex
CREATE INDEX "ServiceUser_lastName_firstName_idx" ON "service_users"."ServiceUser"("lastName", "firstName");

-- CreateIndex
CREATE INDEX "ServiceUserContact_serviceUserId_idx" ON "service_users"."ServiceUserContact"("serviceUserId");

-- CreateIndex
CREATE INDEX "ServiceUserContact_deletedAt_idx" ON "service_users"."ServiceUserContact"("deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceUserAddress_serviceUserId_key" ON "service_users"."ServiceUserAddress"("serviceUserId");

-- CreateIndex
CREATE INDEX "ServiceUserAddress_deletedAt_idx" ON "service_users"."ServiceUserAddress"("deletedAt");

-- CreateIndex
CREATE INDEX "ServiceUserReference_serviceUserId_idx" ON "service_users"."ServiceUserReference"("serviceUserId");

-- CreateIndex
CREATE INDEX "ServiceUserReference_deletedAt_idx" ON "service_users"."ServiceUserReference"("deletedAt");

-- CreateIndex
CREATE INDEX "ServiceUserAssignment_serviceUserId_idx" ON "service_users"."ServiceUserAssignment"("serviceUserId");

-- CreateIndex
CREATE INDEX "ServiceUserAssignment_deletedAt_idx" ON "service_users"."ServiceUserAssignment"("deletedAt");

-- CreateIndex
CREATE INDEX "ServiceUserPhoto_serviceUserId_idx" ON "service_users"."ServiceUserPhoto"("serviceUserId");

-- CreateIndex
CREATE INDEX "ServiceUserPhoto_deletedAt_idx" ON "service_users"."ServiceUserPhoto"("deletedAt");

-- CreateIndex
CREATE INDEX "ComplianceType_deletedAt_idx" ON "lookups"."ComplianceType"("deletedAt");

-- AddForeignKey
ALTER TABLE "service_users"."ServiceUser" ADD CONSTRAINT "ServiceUser_titleId_fkey" FOREIGN KEY ("titleId") REFERENCES "service_users"."ServiceUserTitle"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_users"."ServiceUser" ADD CONSTRAINT "ServiceUser_genderId_fkey" FOREIGN KEY ("genderId") REFERENCES "service_users"."ServiceUserGender"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_users"."ServiceUser" ADD CONSTRAINT "ServiceUser_maritalStatusId_fkey" FOREIGN KEY ("maritalStatusId") REFERENCES "service_users"."ServiceUserMaritalStatus"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_users"."ServiceUser" ADD CONSTRAINT "ServiceUser_statusId_fkey" FOREIGN KEY ("statusId") REFERENCES "service_users"."ServiceUserStatus"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_users"."ServiceUser" ADD CONSTRAINT "ServiceUser_careTypeId_fkey" FOREIGN KEY ("careTypeId") REFERENCES "service_users"."ServiceUserCareType"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_users"."ServiceUser" ADD CONSTRAINT "ServiceUser_fundingTypeId_fkey" FOREIGN KEY ("fundingTypeId") REFERENCES "service_users"."ServiceUserFundingType"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_users"."ServiceUser" ADD CONSTRAINT "ServiceUser_riskLevelId_fkey" FOREIGN KEY ("riskLevelId") REFERENCES "service_users"."ServiceUserRiskLevel"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_users"."ServiceUser" ADD CONSTRAINT "ServiceUser_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "lookups"."Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_users"."ServiceUser" ADD CONSTRAINT "ServiceUser_keyWorkerId_fkey" FOREIGN KEY ("keyWorkerId") REFERENCES "employees"."Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_users"."ServiceUser" ADD CONSTRAINT "ServiceUser_namedNurseId_fkey" FOREIGN KEY ("namedNurseId") REFERENCES "employees"."Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_users"."ServiceUserContact" ADD CONSTRAINT "ServiceUserContact_serviceUserId_fkey" FOREIGN KEY ("serviceUserId") REFERENCES "service_users"."ServiceUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_users"."ServiceUserContact" ADD CONSTRAINT "ServiceUserContact_relationshipTypeId_fkey" FOREIGN KEY ("relationshipTypeId") REFERENCES "service_users"."RelationshipType"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_users"."ServiceUserAddress" ADD CONSTRAINT "ServiceUserAddress_serviceUserId_fkey" FOREIGN KEY ("serviceUserId") REFERENCES "service_users"."ServiceUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_users"."ServiceUserReference" ADD CONSTRAINT "ServiceUserReference_serviceUserId_fkey" FOREIGN KEY ("serviceUserId") REFERENCES "service_users"."ServiceUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_users"."ServiceUserAssignment" ADD CONSTRAINT "ServiceUserAssignment_serviceUserId_fkey" FOREIGN KEY ("serviceUserId") REFERENCES "service_users"."ServiceUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_users"."ServiceUserAssignment" ADD CONSTRAINT "ServiceUserAssignment_keyWorkerId_fkey" FOREIGN KEY ("keyWorkerId") REFERENCES "employees"."Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_users"."ServiceUserAssignment" ADD CONSTRAINT "ServiceUserAssignment_namedNurseId_fkey" FOREIGN KEY ("namedNurseId") REFERENCES "employees"."Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_users"."ServiceUserAssignment" ADD CONSTRAINT "ServiceUserAssignment_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "lookups"."Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_users"."ServiceUserPhoto" ADD CONSTRAINT "ServiceUserPhoto_serviceUserId_fkey" FOREIGN KEY ("serviceUserId") REFERENCES "service_users"."ServiceUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
