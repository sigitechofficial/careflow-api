-- Additive: organisation limit for Backfill past visits (Settings → Dom Care). 0 = backfill off.
-- Existing rows get 14, the limit that was hard-coded before.

-- AlterTable
ALTER TABLE "identity"."OrganisationGeneralSettings" ADD COLUMN "domMaxBackfillDays" INTEGER NOT NULL DEFAULT 14;
