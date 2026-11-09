-- Reply headers kept with each email, so replies thread for every provider (IMAP, Microsoft, webhooks).
ALTER TABLE "service_users"."ReferralEmail"
  ADD COLUMN IF NOT EXISTS "messageIdHeader" TEXT,
  ADD COLUMN IF NOT EXISTS "referencesHeader" TEXT,
  ADD COLUMN IF NOT EXISTS "replyToEmail" TEXT;
