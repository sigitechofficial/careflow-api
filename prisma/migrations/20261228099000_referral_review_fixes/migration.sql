-- Referral automation review fixes.
ALTER TYPE "service_users"."ReferralEmailStatus" ADD VALUE IF NOT EXISTS 'FOLLOW_UP';

ALTER TABLE "service_users"."ReferralEmail" ADD COLUMN IF NOT EXISTS "replyClaimedAt" TIMESTAMP(3);

ALTER TABLE "service_users"."ReferralAutomationSettings"
  ADD COLUMN IF NOT EXISTS "availabilityMode" TEXT NOT NULL DEFAULT 'ANY_CARER_EACH_DAY',
  ADD COLUMN IF NOT EXISTS "travelBufferMinutes" INTEGER NOT NULL DEFAULT 15,
  ALTER COLUMN "autoReplyDecisions" SET DEFAULT ARRAY['YES', 'POSSIBLY', 'NEED_INFO']::TEXT[];

-- A decline is never sent without a manager.
UPDATE "service_users"."ReferralAutomationSettings" SET "autoReplyDecisions" = array_remove("autoReplyDecisions", 'NO');
