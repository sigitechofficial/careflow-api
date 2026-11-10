-- Screening before Claude reads a referral email: settings, and each email's result.
ALTER TABLE "service_users"."ReferralAutomationSettings" ADD COLUMN IF NOT EXISTS "screening" JSONB;
ALTER TABLE "service_users"."ReferralEmail" ADD COLUMN IF NOT EXISTS "screening" JSONB;
