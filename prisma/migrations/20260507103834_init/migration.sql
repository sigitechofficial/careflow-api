/*
  Warnings:

  - You are about to drop the `AuditLog` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `CertificationType` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `ComplianceType` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `ContractType` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `DocumentTag` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `Employee` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `EmployeeCompliance` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `EmployeeDocument` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `EmployeeEmergencyContact` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `EmployeeEmployment` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `EmployeeHoliday` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `EmployeeLeavingRecord` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `EmployeeNonCoreActivity` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `EmployeePersonalDetail` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `EmployeeReview` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `EmployeeRoleLookup` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `EmployeeSkill` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `EmployeeStatus` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `EmployeeWorkCertification` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `EmployeeWorkingPattern` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `Gender` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `Grade` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `JobTitle` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `LeavingReason` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `Location` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `Nationality` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `NonCoreActivityReason` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `Permission` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `RBACLevel` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `ReviewType` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `Role` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `RolePermission` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `SkillType` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `Title` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `TravelPaymentType` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `User` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `UserRole` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `WorkArea` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `Zone` table. If the table is not empty, all the data it contains will be lost.

*/
-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "audit";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "employees";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "identity";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "lookups";

-- CreateEnum
CREATE TYPE "employees"."DayOfWeek" AS ENUM ('MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY');

-- DropForeignKey
ALTER TABLE "AuditLog" DROP CONSTRAINT "AuditLog_userId_fkey";

-- DropForeignKey
ALTER TABLE "EmployeeCompliance" DROP CONSTRAINT "EmployeeCompliance_complianceTypeId_fkey";

-- DropForeignKey
ALTER TABLE "EmployeeCompliance" DROP CONSTRAINT "EmployeeCompliance_employeeId_fkey";

-- DropForeignKey
ALTER TABLE "EmployeeDocument" DROP CONSTRAINT "EmployeeDocument_employeeId_fkey";

-- DropForeignKey
ALTER TABLE "EmployeeDocument" DROP CONSTRAINT "EmployeeDocument_uploadedById_fkey";

-- DropForeignKey
ALTER TABLE "EmployeeEmergencyContact" DROP CONSTRAINT "EmployeeEmergencyContact_employeeId_fkey";

-- DropForeignKey
ALTER TABLE "EmployeeEmployment" DROP CONSTRAINT "EmployeeEmployment_baseLocationId_fkey";

-- DropForeignKey
ALTER TABLE "EmployeeEmployment" DROP CONSTRAINT "EmployeeEmployment_contractTypeId_fkey";

-- DropForeignKey
ALTER TABLE "EmployeeEmployment" DROP CONSTRAINT "EmployeeEmployment_employeeId_fkey";

-- DropForeignKey
ALTER TABLE "EmployeeEmployment" DROP CONSTRAINT "EmployeeEmployment_gradeId_fkey";

-- DropForeignKey
ALTER TABLE "EmployeeEmployment" DROP CONSTRAINT "EmployeeEmployment_jobTitleId_fkey";

-- DropForeignKey
ALTER TABLE "EmployeeEmployment" DROP CONSTRAINT "EmployeeEmployment_leavingReasonId_fkey";

-- DropForeignKey
ALTER TABLE "EmployeeEmployment" DROP CONSTRAINT "EmployeeEmployment_locationId_fkey";

-- DropForeignKey
ALTER TABLE "EmployeeEmployment" DROP CONSTRAINT "EmployeeEmployment_rbacLevelId_fkey";

-- DropForeignKey
ALTER TABLE "EmployeeEmployment" DROP CONSTRAINT "EmployeeEmployment_roleId_fkey";

-- DropForeignKey
ALTER TABLE "EmployeeEmployment" DROP CONSTRAINT "EmployeeEmployment_travelPaymentTypeId_fkey";

-- DropForeignKey
ALTER TABLE "EmployeeEmployment" DROP CONSTRAINT "EmployeeEmployment_workAreaId_fkey";

-- DropForeignKey
ALTER TABLE "EmployeeHoliday" DROP CONSTRAINT "EmployeeHoliday_employeeId_fkey";

-- DropForeignKey
ALTER TABLE "EmployeeLeavingRecord" DROP CONSTRAINT "EmployeeLeavingRecord_employeeId_fkey";

-- DropForeignKey
ALTER TABLE "EmployeeLeavingRecord" DROP CONSTRAINT "EmployeeLeavingRecord_leavingReasonId_fkey";

-- DropForeignKey
ALTER TABLE "EmployeeNonCoreActivity" DROP CONSTRAINT "EmployeeNonCoreActivity_employeeId_fkey";

-- DropForeignKey
ALTER TABLE "EmployeeNonCoreActivity" DROP CONSTRAINT "EmployeeNonCoreActivity_reasonId_fkey";

-- DropForeignKey
ALTER TABLE "EmployeePersonalDetail" DROP CONSTRAINT "EmployeePersonalDetail_employeeId_fkey";

-- DropForeignKey
ALTER TABLE "EmployeePersonalDetail" DROP CONSTRAINT "EmployeePersonalDetail_genderId_fkey";

-- DropForeignKey
ALTER TABLE "EmployeePersonalDetail" DROP CONSTRAINT "EmployeePersonalDetail_nationalityId_fkey";

-- DropForeignKey
ALTER TABLE "EmployeePersonalDetail" DROP CONSTRAINT "EmployeePersonalDetail_statusId_fkey";

-- DropForeignKey
ALTER TABLE "EmployeePersonalDetail" DROP CONSTRAINT "EmployeePersonalDetail_titleId_fkey";

-- DropForeignKey
ALTER TABLE "EmployeeReview" DROP CONSTRAINT "EmployeeReview_employeeId_fkey";

-- DropForeignKey
ALTER TABLE "EmployeeReview" DROP CONSTRAINT "EmployeeReview_reviewTypeId_fkey";

-- DropForeignKey
ALTER TABLE "EmployeeReview" DROP CONSTRAINT "EmployeeReview_reviewedById_fkey";

-- DropForeignKey
ALTER TABLE "EmployeeSkill" DROP CONSTRAINT "EmployeeSkill_employeeId_fkey";

-- DropForeignKey
ALTER TABLE "EmployeeSkill" DROP CONSTRAINT "EmployeeSkill_skillTypeId_fkey";

-- DropForeignKey
ALTER TABLE "EmployeeWorkCertification" DROP CONSTRAINT "EmployeeWorkCertification_certificationTypeId_fkey";

-- DropForeignKey
ALTER TABLE "EmployeeWorkCertification" DROP CONSTRAINT "EmployeeWorkCertification_employeeId_fkey";

-- DropForeignKey
ALTER TABLE "EmployeeWorkingPattern" DROP CONSTRAINT "EmployeeWorkingPattern_employeeId_fkey";

-- DropForeignKey
ALTER TABLE "RolePermission" DROP CONSTRAINT "RolePermission_permissionId_fkey";

-- DropForeignKey
ALTER TABLE "RolePermission" DROP CONSTRAINT "RolePermission_roleId_fkey";

-- DropForeignKey
ALTER TABLE "User" DROP CONSTRAINT "User_createdById_fkey";

-- DropForeignKey
ALTER TABLE "User" DROP CONSTRAINT "User_deletedById_fkey";

-- DropForeignKey
ALTER TABLE "User" DROP CONSTRAINT "User_updatedById_fkey";

-- DropForeignKey
ALTER TABLE "UserRole" DROP CONSTRAINT "UserRole_roleId_fkey";

-- DropForeignKey
ALTER TABLE "UserRole" DROP CONSTRAINT "UserRole_userId_fkey";

-- DropTable
DROP TABLE "AuditLog";

-- DropTable
DROP TABLE "CertificationType";

-- DropTable
DROP TABLE "ComplianceType";

-- DropTable
DROP TABLE "ContractType";

-- DropTable
DROP TABLE "DocumentTag";

-- DropTable
DROP TABLE "Employee";

-- DropTable
DROP TABLE "EmployeeCompliance";

-- DropTable
DROP TABLE "EmployeeDocument";

-- DropTable
DROP TABLE "EmployeeEmergencyContact";

-- DropTable
DROP TABLE "EmployeeEmployment";

-- DropTable
DROP TABLE "EmployeeHoliday";

-- DropTable
DROP TABLE "EmployeeLeavingRecord";

-- DropTable
DROP TABLE "EmployeeNonCoreActivity";

-- DropTable
DROP TABLE "EmployeePersonalDetail";

-- DropTable
DROP TABLE "EmployeeReview";

-- DropTable
DROP TABLE "EmployeeRoleLookup";

-- DropTable
DROP TABLE "EmployeeSkill";

-- DropTable
DROP TABLE "EmployeeStatus";

-- DropTable
DROP TABLE "EmployeeWorkCertification";

-- DropTable
DROP TABLE "EmployeeWorkingPattern";

-- DropTable
DROP TABLE "Gender";

-- DropTable
DROP TABLE "Grade";

-- DropTable
DROP TABLE "JobTitle";

-- DropTable
DROP TABLE "LeavingReason";

-- DropTable
DROP TABLE "Location";

-- DropTable
DROP TABLE "Nationality";

-- DropTable
DROP TABLE "NonCoreActivityReason";

-- DropTable
DROP TABLE "Permission";

-- DropTable
DROP TABLE "RBACLevel";

-- DropTable
DROP TABLE "ReviewType";

-- DropTable
DROP TABLE "Role";

-- DropTable
DROP TABLE "RolePermission";

-- DropTable
DROP TABLE "SkillType";

-- DropTable
DROP TABLE "Title";

-- DropTable
DROP TABLE "TravelPaymentType";

-- DropTable
DROP TABLE "User";

-- DropTable
DROP TABLE "UserRole";

-- DropTable
DROP TABLE "WorkArea";

-- DropTable
DROP TABLE "Zone";

-- DropEnum
DROP TYPE "DayOfWeek";

-- CreateTable
CREATE TABLE "identity"."User" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "username" TEXT,
    "passwordHash" TEXT NOT NULL,
    "firstName" TEXT,
    "lastName" TEXT,
    "refreshTokenHash" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdById" UUID,
    "updatedById" UUID,
    "deletedById" UUID,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "identity"."Role" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdById" UUID,
    "updatedById" UUID,
    "deletedById" UUID,

    CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "identity"."Permission" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdById" UUID,
    "updatedById" UUID,
    "deletedById" UUID,

    CONSTRAINT "Permission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "identity"."RolePermission" (
    "id" UUID NOT NULL,
    "roleId" UUID NOT NULL,
    "permissionId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RolePermission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "identity"."UserRole" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "roleId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserRole_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employees"."Employee" (
    "id" UUID NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdById" UUID,
    "updatedById" UUID,
    "deletedById" UUID,

    CONSTRAINT "Employee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employees"."EmployeePersonalDetail" (
    "id" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "titleId" UUID,
    "genderId" UUID,
    "email" TEXT,
    "username" TEXT,
    "dateOfBirth" TIMESTAMP(3),
    "nationalityId" UUID,
    "addressLine1" TEXT,
    "addressLine2" TEXT,
    "town" TEXT,
    "country" TEXT,
    "postcode" TEXT,
    "homeTelephone" TEXT,
    "mobileTelephone" TEXT,
    "photoUrl" TEXT,
    "statusId" UUID,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdById" UUID,
    "updatedById" UUID,
    "deletedById" UUID,

    CONSTRAINT "EmployeePersonalDetail_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employees"."EmployeeEmergencyContact" (
    "id" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "relationship" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdById" UUID,
    "updatedById" UUID,
    "deletedById" UUID,

    CONSTRAINT "EmployeeEmergencyContact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employees"."EmployeeEmployment" (
    "id" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "workAreaId" UUID,
    "roleId" UUID,
    "jobTitleId" UUID,
    "rbacLevelId" UUID,
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "leavingReasonId" UUID,
    "leavingNotes" TEXT,
    "nationalInsuranceNo" TEXT,
    "gradeId" UUID,
    "nmcPinNumber" TEXT,
    "contractTypeId" UUID,
    "employeeNumber" TEXT,
    "travelPaymentTypeId" UUID,
    "payrollNumber" TEXT,
    "baseLocationId" UUID,
    "locationId" UUID,
    "accessAllZones" BOOLEAN NOT NULL DEFAULT false,
    "defaultZoneView" BOOLEAN NOT NULL DEFAULT false,
    "contractedWeeklyHours" DOUBLE PRECISION,
    "maximumWeeklyHours" DOUBLE PRECISION,
    "minimumWeeklyHours" DOUBLE PRECISION,
    "optedOutOf48Hours" BOOLEAN NOT NULL DEFAULT false,
    "isAgencyStaff" BOOLEAN NOT NULL DEFAULT false,
    "agencyName" TEXT,
    "agencyRating" TEXT,
    "isPreferredAgency" BOOLEAN NOT NULL DEFAULT false,
    "isBlacklisted" BOOLEAN NOT NULL DEFAULT false,
    "dailyRate" DOUBLE PRECISION,
    "hourlyDayRate" DOUBLE PRECISION,
    "hourlyNightRate" DOUBLE PRECISION,
    "isBankStaff" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdById" UUID,
    "updatedById" UUID,
    "deletedById" UUID,

    CONSTRAINT "EmployeeEmployment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employees"."EmployeeSkill" (
    "id" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "skillTypeId" UUID,
    "expiryDate" TIMESTAMP(3),
    "notes" TEXT,
    "documentUrl" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdById" UUID,
    "updatedById" UUID,
    "deletedById" UUID,

    CONSTRAINT "EmployeeSkill_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employees"."EmployeeWorkCertification" (
    "id" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "certificationTypeId" UUID,
    "reference" TEXT,
    "issueDate" TIMESTAMP(3),
    "expiryDate" TIMESTAMP(3),
    "notes" TEXT,
    "certificateUrl" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdById" UUID,
    "updatedById" UUID,
    "deletedById" UUID,

    CONSTRAINT "EmployeeWorkCertification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employees"."EmployeeReview" (
    "id" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "reviewTypeId" UUID,
    "status" TEXT,
    "lastDone" TIMESTAMP(3),
    "nextDue" TIMESTAMP(3),
    "notes" TEXT,
    "reviewedById" UUID,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdById" UUID,
    "updatedById" UUID,
    "deletedById" UUID,

    CONSTRAINT "EmployeeReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employees"."EmployeeDocument" (
    "id" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "fileUrl" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "mimeType" TEXT NOT NULL,
    "uploadedById" UUID,
    "uploadedDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "tags" TEXT[],
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdById" UUID,
    "updatedById" UUID,
    "deletedById" UUID,

    CONSTRAINT "EmployeeDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employees"."EmployeeNonCoreActivity" (
    "id" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "reasonId" UUID,
    "dateFrom" TIMESTAMP(3) NOT NULL,
    "dateTo" TIMESTAMP(3) NOT NULL,
    "includeInPayroll" BOOLEAN NOT NULL DEFAULT false,
    "onCallForPeriod" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdById" UUID,
    "updatedById" UUID,
    "deletedById" UUID,

    CONSTRAINT "EmployeeNonCoreActivity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employees"."EmployeeWorkingPattern" (
    "id" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "dayOfWeek" "employees"."DayOfWeek" NOT NULL,
    "startTime" TEXT,
    "endTime" TEXT,
    "isAvailable" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdById" UUID,
    "updatedById" UUID,
    "deletedById" UUID,

    CONSTRAINT "EmployeeWorkingPattern_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employees"."EmployeeCompliance" (
    "id" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "complianceTypeId" UUID,
    "status" TEXT,
    "issueDate" TIMESTAMP(3),
    "expiryDate" TIMESTAMP(3),
    "documentUrl" TEXT,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdById" UUID,
    "updatedById" UUID,
    "deletedById" UUID,

    CONSTRAINT "EmployeeCompliance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employees"."EmployeeHoliday" (
    "id" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdById" UUID,
    "updatedById" UUID,
    "deletedById" UUID,

    CONSTRAINT "EmployeeHoliday_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employees"."EmployeeLeavingRecord" (
    "id" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "leavingReasonId" UUID,
    "leavingDate" TIMESTAMP(3) NOT NULL,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdById" UUID,
    "updatedById" UUID,
    "deletedById" UUID,

    CONSTRAINT "EmployeeLeavingRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit"."AuditLog" (
    "id" UUID NOT NULL,
    "userId" UUID,
    "action" TEXT NOT NULL,
    "entity" TEXT,
    "entityId" UUID,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lookups"."Title" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Title_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lookups"."Gender" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Gender_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lookups"."Nationality" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Nationality_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lookups"."EmployeeStatus" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "EmployeeStatus_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lookups"."WorkArea" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "WorkArea_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lookups"."EmployeeRoleLookup" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "EmployeeRoleLookup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lookups"."JobTitle" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "JobTitle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lookups"."RBACLevel" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "RBACLevel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lookups"."Grade" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Grade_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lookups"."ContractType" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "ContractType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lookups"."TravelPaymentType" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "TravelPaymentType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lookups"."Location" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Location_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lookups"."Zone" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Zone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lookups"."LeavingReason" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "LeavingReason_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lookups"."SkillType" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "SkillType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lookups"."CertificationType" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "CertificationType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lookups"."ComplianceType" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "ComplianceType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lookups"."ReviewType" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "ReviewType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lookups"."NonCoreActivityReason" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "NonCoreActivityReason_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lookups"."DocumentTag" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "DocumentTag_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "identity"."User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "identity"."User"("username");

-- CreateIndex
CREATE INDEX "User_email_idx" ON "identity"."User"("email");

-- CreateIndex
CREATE INDEX "User_deletedAt_idx" ON "identity"."User"("deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Role_name_key" ON "identity"."Role"("name");

-- CreateIndex
CREATE INDEX "Role_deletedAt_idx" ON "identity"."Role"("deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Permission_key_key" ON "identity"."Permission"("key");

-- CreateIndex
CREATE INDEX "Permission_deletedAt_idx" ON "identity"."Permission"("deletedAt");

-- CreateIndex
CREATE INDEX "RolePermission_roleId_idx" ON "identity"."RolePermission"("roleId");

-- CreateIndex
CREATE INDEX "RolePermission_permissionId_idx" ON "identity"."RolePermission"("permissionId");

-- CreateIndex
CREATE UNIQUE INDEX "RolePermission_roleId_permissionId_key" ON "identity"."RolePermission"("roleId", "permissionId");

-- CreateIndex
CREATE INDEX "UserRole_userId_idx" ON "identity"."UserRole"("userId");

-- CreateIndex
CREATE INDEX "UserRole_roleId_idx" ON "identity"."UserRole"("roleId");

-- CreateIndex
CREATE UNIQUE INDEX "UserRole_userId_roleId_key" ON "identity"."UserRole"("userId", "roleId");

-- CreateIndex
CREATE INDEX "Employee_deletedAt_idx" ON "employees"."Employee"("deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "EmployeePersonalDetail_employeeId_key" ON "employees"."EmployeePersonalDetail"("employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "EmployeePersonalDetail_email_key" ON "employees"."EmployeePersonalDetail"("email");

-- CreateIndex
CREATE UNIQUE INDEX "EmployeePersonalDetail_username_key" ON "employees"."EmployeePersonalDetail"("username");

-- CreateIndex
CREATE INDEX "EmployeePersonalDetail_employeeId_idx" ON "employees"."EmployeePersonalDetail"("employeeId");

-- CreateIndex
CREATE INDEX "EmployeePersonalDetail_lastName_firstName_idx" ON "employees"."EmployeePersonalDetail"("lastName", "firstName");

-- CreateIndex
CREATE INDEX "EmployeePersonalDetail_deletedAt_idx" ON "employees"."EmployeePersonalDetail"("deletedAt");

-- CreateIndex
CREATE INDEX "EmployeeEmergencyContact_employeeId_idx" ON "employees"."EmployeeEmergencyContact"("employeeId");

-- CreateIndex
CREATE INDEX "EmployeeEmergencyContact_deletedAt_idx" ON "employees"."EmployeeEmergencyContact"("deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "EmployeeEmployment_employeeId_key" ON "employees"."EmployeeEmployment"("employeeId");

-- CreateIndex
CREATE INDEX "EmployeeEmployment_employeeId_idx" ON "employees"."EmployeeEmployment"("employeeId");

-- CreateIndex
CREATE INDEX "EmployeeEmployment_deletedAt_idx" ON "employees"."EmployeeEmployment"("deletedAt");

-- CreateIndex
CREATE INDEX "EmployeeSkill_employeeId_idx" ON "employees"."EmployeeSkill"("employeeId");

-- CreateIndex
CREATE INDEX "EmployeeSkill_deletedAt_idx" ON "employees"."EmployeeSkill"("deletedAt");

-- CreateIndex
CREATE INDEX "EmployeeWorkCertification_employeeId_idx" ON "employees"."EmployeeWorkCertification"("employeeId");

-- CreateIndex
CREATE INDEX "EmployeeWorkCertification_deletedAt_idx" ON "employees"."EmployeeWorkCertification"("deletedAt");

-- CreateIndex
CREATE INDEX "EmployeeReview_employeeId_idx" ON "employees"."EmployeeReview"("employeeId");

-- CreateIndex
CREATE INDEX "EmployeeReview_deletedAt_idx" ON "employees"."EmployeeReview"("deletedAt");

-- CreateIndex
CREATE INDEX "EmployeeDocument_employeeId_idx" ON "employees"."EmployeeDocument"("employeeId");

-- CreateIndex
CREATE INDEX "EmployeeDocument_uploadedDate_idx" ON "employees"."EmployeeDocument"("uploadedDate");

-- CreateIndex
CREATE INDEX "EmployeeDocument_deletedAt_idx" ON "employees"."EmployeeDocument"("deletedAt");

-- CreateIndex
CREATE INDEX "EmployeeNonCoreActivity_employeeId_idx" ON "employees"."EmployeeNonCoreActivity"("employeeId");

-- CreateIndex
CREATE INDEX "EmployeeNonCoreActivity_dateFrom_dateTo_idx" ON "employees"."EmployeeNonCoreActivity"("dateFrom", "dateTo");

-- CreateIndex
CREATE INDEX "EmployeeNonCoreActivity_deletedAt_idx" ON "employees"."EmployeeNonCoreActivity"("deletedAt");

-- CreateIndex
CREATE INDEX "EmployeeWorkingPattern_employeeId_idx" ON "employees"."EmployeeWorkingPattern"("employeeId");

-- CreateIndex
CREATE INDEX "EmployeeWorkingPattern_dayOfWeek_idx" ON "employees"."EmployeeWorkingPattern"("dayOfWeek");

-- CreateIndex
CREATE INDEX "EmployeeWorkingPattern_deletedAt_idx" ON "employees"."EmployeeWorkingPattern"("deletedAt");

-- CreateIndex
CREATE INDEX "EmployeeCompliance_employeeId_idx" ON "employees"."EmployeeCompliance"("employeeId");

-- CreateIndex
CREATE INDEX "EmployeeCompliance_expiryDate_idx" ON "employees"."EmployeeCompliance"("expiryDate");

-- CreateIndex
CREATE INDEX "EmployeeCompliance_deletedAt_idx" ON "employees"."EmployeeCompliance"("deletedAt");

-- CreateIndex
CREATE INDEX "EmployeeHoliday_employeeId_idx" ON "employees"."EmployeeHoliday"("employeeId");

-- CreateIndex
CREATE INDEX "EmployeeHoliday_deletedAt_idx" ON "employees"."EmployeeHoliday"("deletedAt");

-- CreateIndex
CREATE INDEX "EmployeeLeavingRecord_employeeId_idx" ON "employees"."EmployeeLeavingRecord"("employeeId");

-- CreateIndex
CREATE INDEX "EmployeeLeavingRecord_deletedAt_idx" ON "employees"."EmployeeLeavingRecord"("deletedAt");

-- CreateIndex
CREATE INDEX "AuditLog_userId_idx" ON "audit"."AuditLog"("userId");

-- CreateIndex
CREATE INDEX "AuditLog_entity_entityId_idx" ON "audit"."AuditLog"("entity", "entityId");

-- CreateIndex
CREATE UNIQUE INDEX "Title_name_key" ON "lookups"."Title"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Gender_name_key" ON "lookups"."Gender"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Nationality_name_key" ON "lookups"."Nationality"("name");

-- CreateIndex
CREATE UNIQUE INDEX "EmployeeStatus_name_key" ON "lookups"."EmployeeStatus"("name");

-- CreateIndex
CREATE UNIQUE INDEX "WorkArea_name_key" ON "lookups"."WorkArea"("name");

-- CreateIndex
CREATE UNIQUE INDEX "EmployeeRoleLookup_name_key" ON "lookups"."EmployeeRoleLookup"("name");

-- CreateIndex
CREATE UNIQUE INDEX "JobTitle_name_key" ON "lookups"."JobTitle"("name");

-- CreateIndex
CREATE UNIQUE INDEX "RBACLevel_name_key" ON "lookups"."RBACLevel"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Grade_name_key" ON "lookups"."Grade"("name");

-- CreateIndex
CREATE UNIQUE INDEX "ContractType_name_key" ON "lookups"."ContractType"("name");

-- CreateIndex
CREATE UNIQUE INDEX "TravelPaymentType_name_key" ON "lookups"."TravelPaymentType"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Location_name_key" ON "lookups"."Location"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Zone_name_key" ON "lookups"."Zone"("name");

-- CreateIndex
CREATE UNIQUE INDEX "LeavingReason_name_key" ON "lookups"."LeavingReason"("name");

-- CreateIndex
CREATE UNIQUE INDEX "SkillType_name_key" ON "lookups"."SkillType"("name");

-- CreateIndex
CREATE UNIQUE INDEX "CertificationType_name_key" ON "lookups"."CertificationType"("name");

-- CreateIndex
CREATE UNIQUE INDEX "ComplianceType_name_key" ON "lookups"."ComplianceType"("name");

-- CreateIndex
CREATE UNIQUE INDEX "ReviewType_name_key" ON "lookups"."ReviewType"("name");

-- CreateIndex
CREATE UNIQUE INDEX "NonCoreActivityReason_name_key" ON "lookups"."NonCoreActivityReason"("name");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentTag_name_key" ON "lookups"."DocumentTag"("name");

-- AddForeignKey
ALTER TABLE "identity"."User" ADD CONSTRAINT "User_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "identity"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "identity"."User" ADD CONSTRAINT "User_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "identity"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "identity"."User" ADD CONSTRAINT "User_deletedById_fkey" FOREIGN KEY ("deletedById") REFERENCES "identity"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "identity"."RolePermission" ADD CONSTRAINT "RolePermission_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "identity"."Role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "identity"."RolePermission" ADD CONSTRAINT "RolePermission_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "identity"."Permission"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "identity"."UserRole" ADD CONSTRAINT "UserRole_userId_fkey" FOREIGN KEY ("userId") REFERENCES "identity"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "identity"."UserRole" ADD CONSTRAINT "UserRole_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "identity"."Role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees"."EmployeePersonalDetail" ADD CONSTRAINT "EmployeePersonalDetail_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"."Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees"."EmployeePersonalDetail" ADD CONSTRAINT "EmployeePersonalDetail_titleId_fkey" FOREIGN KEY ("titleId") REFERENCES "lookups"."Title"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees"."EmployeePersonalDetail" ADD CONSTRAINT "EmployeePersonalDetail_genderId_fkey" FOREIGN KEY ("genderId") REFERENCES "lookups"."Gender"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees"."EmployeePersonalDetail" ADD CONSTRAINT "EmployeePersonalDetail_nationalityId_fkey" FOREIGN KEY ("nationalityId") REFERENCES "lookups"."Nationality"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees"."EmployeePersonalDetail" ADD CONSTRAINT "EmployeePersonalDetail_statusId_fkey" FOREIGN KEY ("statusId") REFERENCES "lookups"."EmployeeStatus"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees"."EmployeeEmergencyContact" ADD CONSTRAINT "EmployeeEmergencyContact_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"."Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees"."EmployeeEmployment" ADD CONSTRAINT "EmployeeEmployment_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"."Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees"."EmployeeEmployment" ADD CONSTRAINT "EmployeeEmployment_workAreaId_fkey" FOREIGN KEY ("workAreaId") REFERENCES "lookups"."WorkArea"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees"."EmployeeEmployment" ADD CONSTRAINT "EmployeeEmployment_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "lookups"."EmployeeRoleLookup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees"."EmployeeEmployment" ADD CONSTRAINT "EmployeeEmployment_jobTitleId_fkey" FOREIGN KEY ("jobTitleId") REFERENCES "lookups"."JobTitle"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees"."EmployeeEmployment" ADD CONSTRAINT "EmployeeEmployment_rbacLevelId_fkey" FOREIGN KEY ("rbacLevelId") REFERENCES "lookups"."RBACLevel"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees"."EmployeeEmployment" ADD CONSTRAINT "EmployeeEmployment_gradeId_fkey" FOREIGN KEY ("gradeId") REFERENCES "lookups"."Grade"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees"."EmployeeEmployment" ADD CONSTRAINT "EmployeeEmployment_contractTypeId_fkey" FOREIGN KEY ("contractTypeId") REFERENCES "lookups"."ContractType"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees"."EmployeeEmployment" ADD CONSTRAINT "EmployeeEmployment_travelPaymentTypeId_fkey" FOREIGN KEY ("travelPaymentTypeId") REFERENCES "lookups"."TravelPaymentType"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees"."EmployeeEmployment" ADD CONSTRAINT "EmployeeEmployment_baseLocationId_fkey" FOREIGN KEY ("baseLocationId") REFERENCES "lookups"."Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees"."EmployeeEmployment" ADD CONSTRAINT "EmployeeEmployment_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "lookups"."Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees"."EmployeeEmployment" ADD CONSTRAINT "EmployeeEmployment_leavingReasonId_fkey" FOREIGN KEY ("leavingReasonId") REFERENCES "lookups"."LeavingReason"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees"."EmployeeSkill" ADD CONSTRAINT "EmployeeSkill_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"."Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees"."EmployeeSkill" ADD CONSTRAINT "EmployeeSkill_skillTypeId_fkey" FOREIGN KEY ("skillTypeId") REFERENCES "lookups"."SkillType"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees"."EmployeeWorkCertification" ADD CONSTRAINT "EmployeeWorkCertification_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"."Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees"."EmployeeWorkCertification" ADD CONSTRAINT "EmployeeWorkCertification_certificationTypeId_fkey" FOREIGN KEY ("certificationTypeId") REFERENCES "lookups"."CertificationType"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees"."EmployeeReview" ADD CONSTRAINT "EmployeeReview_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"."Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees"."EmployeeReview" ADD CONSTRAINT "EmployeeReview_reviewTypeId_fkey" FOREIGN KEY ("reviewTypeId") REFERENCES "lookups"."ReviewType"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees"."EmployeeReview" ADD CONSTRAINT "EmployeeReview_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "identity"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees"."EmployeeDocument" ADD CONSTRAINT "EmployeeDocument_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"."Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees"."EmployeeDocument" ADD CONSTRAINT "EmployeeDocument_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "identity"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees"."EmployeeNonCoreActivity" ADD CONSTRAINT "EmployeeNonCoreActivity_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"."Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees"."EmployeeNonCoreActivity" ADD CONSTRAINT "EmployeeNonCoreActivity_reasonId_fkey" FOREIGN KEY ("reasonId") REFERENCES "lookups"."NonCoreActivityReason"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees"."EmployeeWorkingPattern" ADD CONSTRAINT "EmployeeWorkingPattern_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"."Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees"."EmployeeCompliance" ADD CONSTRAINT "EmployeeCompliance_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"."Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees"."EmployeeCompliance" ADD CONSTRAINT "EmployeeCompliance_complianceTypeId_fkey" FOREIGN KEY ("complianceTypeId") REFERENCES "lookups"."ComplianceType"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees"."EmployeeHoliday" ADD CONSTRAINT "EmployeeHoliday_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"."Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees"."EmployeeLeavingRecord" ADD CONSTRAINT "EmployeeLeavingRecord_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"."Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees"."EmployeeLeavingRecord" ADD CONSTRAINT "EmployeeLeavingRecord_leavingReasonId_fkey" FOREIGN KEY ("leavingReasonId") REFERENCES "lookups"."LeavingReason"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit"."AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "identity"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
