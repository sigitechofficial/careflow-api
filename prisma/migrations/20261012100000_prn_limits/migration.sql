-- AlterTable: optional PRN limits set by the office on a PRN medicine
ALTER TABLE "service_users"."ServiceUserMedication" ADD COLUMN     "prnMinGapHours" DOUBLE PRECISION,
ADD COLUMN     "prnMaxDosesIn24Hours" INTEGER,
ADD COLUMN     "prnMaxDosePerTime" VARCHAR(100);

-- AlterTable: mark a PRN dose given outside those limits
ALTER TABLE "service_users"."MedicationAdministrationEvent" ADD COLUMN     "prnOverLimit" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "prnOverLimitDetail" VARCHAR(300);
