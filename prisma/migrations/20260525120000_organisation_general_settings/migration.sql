-- CreateEnum
CREATE TYPE "identity"."TimeDisplayFormat" AS ENUM ('HH_XX', 'HH_MM');

-- CreateTable
CREATE TABLE "identity"."OrganisationGeneralSettings" (
    "id" UUID NOT NULL,
    "reviewCarePlanAfterDays" INTEGER NOT NULL DEFAULT 180,
    "handoverReportLastHours" INTEGER NOT NULL DEFAULT 12,
    "archiveServiceUserAfterMonths" INTEGER NOT NULL DEFAULT 3,
    "timeDisplayFormat" "identity"."TimeDisplayFormat" NOT NULL DEFAULT 'HH_MM',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" UUID,

    CONSTRAINT "OrganisationGeneralSettings_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "identity"."OrganisationGeneralSettings" ADD CONSTRAINT "OrganisationGeneralSettings_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "identity"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
