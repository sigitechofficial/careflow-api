-- CreateEnum
CREATE TYPE "identity"."DefaultCarerStatus" AS ENUM ('ACTIVE', 'INACTIVE');
CREATE TYPE "identity"."HolidayUnit" AS ENUM ('HOURS', 'DAYS');
CREATE TYPE "identity"."ComplianceRequiredBy" AS ENUM ('ROLE_WORK_AREA', 'CITIZENSHIP');
CREATE TYPE "identity"."ComplianceApprovalType" AS ENUM ('MANAGER_APPROVAL', 'HR_APPROVAL');
CREATE TYPE "identity"."WellbeingRegularity" AS ENUM ('DAILY', 'WEEKLY', 'MONTHLY');

-- AlterTable
ALTER TABLE "identity"."OrganisationGeneralSettings"
    ADD COLUMN "defaultCarerStatus" "identity"."DefaultCarerStatus" NOT NULL DEFAULT 'ACTIVE',
    ADD COLUMN "sendEmailWhenEmployeeActive" BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN "allowMultipleRoles" BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN "allowWeekendDaysInHoliday" BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN "mandateComplianceForNewEmployees" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "defaultHolidaysUnit" "identity"."HolidayUnit" NOT NULL DEFAULT 'DAYS',
    ADD COLUMN "recruitmentFunctionalityRequired" BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN "complianceRequiredBy" "identity"."ComplianceRequiredBy" NOT NULL DEFAULT 'ROLE_WORK_AREA',
    ADD COLUMN "complianceApprovalForNewEmployee" "identity"."ComplianceApprovalType" NOT NULL DEFAULT 'MANAGER_APPROVAL',
    ADD COLUMN "calculateSicknessBradfordScale" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "recordServiceUserWellbeing" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "recordEmployeeWellbeing" BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN "wellbeingRegularity" "identity"."WellbeingRegularity" NOT NULL DEFAULT 'DAILY',
    ADD COLUMN "wellbeingLabel1" TEXT NOT NULL DEFAULT 'Very Happy',
    ADD COLUMN "wellbeingLabel2" TEXT NOT NULL DEFAULT 'Somewhat Happy',
    ADD COLUMN "wellbeingLabel3" TEXT NOT NULL DEFAULT 'Somewhat sad',
    ADD COLUMN "wellbeingLabel4" TEXT NOT NULL DEFAULT 'sad',
    ADD COLUMN "wellbeingLabel5" TEXT NOT NULL DEFAULT 'Very Sad';
