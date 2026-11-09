-- Mailboxes can be turned off (isActive = false, settings kept) or removed (secrets wiped, row kept for its emails).
ALTER TABLE "service_users"."ReferralMailbox" ADD COLUMN IF NOT EXISTS "removedAt" TIMESTAMP(3);
