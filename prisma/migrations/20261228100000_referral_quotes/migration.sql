-- Automatic quotations from referral emails, formatted replies and copies.
ALTER TABLE "service_users"."ReferralEmail"
  ADD COLUMN IF NOT EXISTS "replyHtml" TEXT,
  ADD COLUMN IF NOT EXISTS "replyCopiedTo" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN IF NOT EXISTS "quotationId" UUID,
  ADD COLUMN IF NOT EXISTS "quotationVersionId" UUID,
  ADD COLUMN IF NOT EXISTS "rateSource" TEXT;

ALTER TABLE "service_users"."ReferralAutomationSettings"
  ADD COLUMN IF NOT EXISTS "copyRepliesTo" TEXT[] NOT NULL DEFAULT ARRAY['suzettethomas@allforcare.co.uk']::TEXT[],
  ADD COLUMN IF NOT EXISTS "autoQuote" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "quoteValidDays" INTEGER NOT NULL DEFAULT 30;

CREATE TABLE IF NOT EXISTS "service_users"."QuoteStandardRate" (
  "id" UUID NOT NULL,
  "locationId" UUID,
  "hourlyRate" DECIMAL(10,2) NOT NULL,
  "rates" JSONB,
  "notes" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "updatedById" UUID,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "QuoteStandardRate_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "QuoteStandardRate_locationId_idx" ON "service_users"."QuoteStandardRate"("locationId");
