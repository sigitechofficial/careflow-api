-- Add staff gender preference to DOM care
ALTER TABLE "service_users"."ServiceUserDomCare"
ADD COLUMN "staffGenderPreference" TEXT;
