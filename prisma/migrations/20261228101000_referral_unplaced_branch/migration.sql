-- Branch for enquiries created from emails whose area can't be worked out (e.g. price-only emails with no postcode).
ALTER TABLE "service_users"."ReferralAutomationSettings" ADD COLUMN IF NOT EXISTS "unplacedLocationId" UUID;
