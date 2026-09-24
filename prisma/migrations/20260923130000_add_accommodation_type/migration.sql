-- Add accommodation type (JSON array) to DOM care
ALTER TABLE "service_users"."ServiceUserDomCare"
ADD COLUMN "accommodationType" JSONB;
