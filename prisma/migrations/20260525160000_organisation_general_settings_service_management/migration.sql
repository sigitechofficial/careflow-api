-- CreateEnum
CREATE TYPE "identity"."ActionsDefaultView" AS ENUM ('TASK_LIST', 'ACTIONS_LIST');
CREATE TYPE "identity"."AllocateEmployeeBy" AS ENUM ('FLOOR', 'WARD', 'ZONE', 'UNIT');

-- AlterTable
ALTER TABLE "identity"."OrganisationGeneralSettings"
    ADD COLUMN "enhancedRegularActionChecks" BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN "showRegularActionsInDailyList" BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN "allowFastAction" BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN "actionsDefaultView" "identity"."ActionsDefaultView" NOT NULL DEFAULT 'TASK_LIST',
    ADD COLUMN "appDefaultToObservationsTab" BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN "allocateEmployeeBy" "identity"."AllocateEmployeeBy" NOT NULL DEFAULT 'FLOOR',
    ADD COLUMN "restrictCarerToAllocatedServiceUsers" BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN "restrictLoginToShiftTimes" BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN "preventCarerWebLogin" BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN "shiftAccessMinutesBefore" INTEGER NOT NULL DEFAULT 60,
    ADD COLUMN "shiftAccessMinutesAfter" INTEGER NOT NULL DEFAULT 30;
