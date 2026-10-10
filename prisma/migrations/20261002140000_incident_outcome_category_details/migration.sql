-- AlterTable: hospital outcome at raise (nullable = "Not known", e.g. phone-reported) and
-- category-specific answers (validated per category in the API).
ALTER TABLE "incidents"."Incident"
  ADD COLUMN "ambulanceAttended" BOOLEAN,
  ADD COLUMN "takenToAe" BOOLEAN,
  ADD COLUMN "admittedToHospital" BOOLEAN,
  ADD COLUMN "categoryDetails" JSONB;
