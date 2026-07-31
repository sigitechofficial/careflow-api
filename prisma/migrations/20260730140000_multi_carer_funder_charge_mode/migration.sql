-- CreateEnum
CREATE TYPE "identity"."MultiCarerFunderChargeMode" AS ENUM ('COMBINED', 'FIXED');

-- AlterTable
ALTER TABLE "identity"."OrganisationGeneralSettings"
    ADD COLUMN "multiCarerFunderChargeMode" "identity"."MultiCarerFunderChargeMode" NOT NULL DEFAULT 'COMBINED';
