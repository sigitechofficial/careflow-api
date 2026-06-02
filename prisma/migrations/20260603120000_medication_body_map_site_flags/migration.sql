-- AlterTable
ALTER TABLE "service_users"."MedicationType" ADD COLUMN "requiresBodyMapSite" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "service_users"."MedicationRoute" ADD COLUMN "requiresBodyMapSite" BOOLEAN NOT NULL DEFAULT false;
