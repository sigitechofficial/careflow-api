-- Referral rules: action per kind of email, outcome per care rule, and the provider's own written rules.
ALTER TABLE "service_users"."ReferralAutomationSettings" ADD COLUMN IF NOT EXISTS "rules" JSONB;
