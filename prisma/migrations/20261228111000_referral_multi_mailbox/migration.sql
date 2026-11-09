-- Several referral mailboxes, from Gmail, Microsoft 365, IMAP/SMTP hosts or an inbound webhook.
ALTER TYPE "service_users"."ReferralMailboxProvider" ADD VALUE IF NOT EXISTS 'IMAP';
ALTER TYPE "service_users"."ReferralMailboxProvider" ADD VALUE IF NOT EXISTS 'INBOUND_WEBHOOK';

ALTER TABLE "service_users"."ReferralMailbox"
  ADD COLUMN IF NOT EXISTS "displayName" TEXT,
  ADD COLUMN IF NOT EXISTS "defaultLocationId" UUID,
  ADD COLUMN IF NOT EXISTS "encryptedSecret" TEXT,
  ADD COLUMN IF NOT EXISTS "config" JSONB,
  ADD COLUMN IF NOT EXISTS "webhookTokenHash" TEXT,
  ADD COLUMN IF NOT EXISTS "sendVia" TEXT NOT NULL DEFAULT 'MAILBOX',
  ADD COLUMN IF NOT EXISTS "relayConfig" JSONB,
  ADD COLUMN IF NOT EXISTS "encryptedRelaySecret" TEXT;

ALTER TABLE "service_users"."ReferralMailbox" ALTER COLUMN "encryptedRefreshToken" DROP NOT NULL;
