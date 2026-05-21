ALTER TABLE "service_users"."ServiceUserMedication"
  ADD COLUMN "expiryDate" TIMESTAMP(3),
  ADD COLUMN "howAssisted" TEXT;
