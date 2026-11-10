-- Message delivery settings (who emails, texts, WhatsApp messages and push notifications may go to) and the delivery log.
CREATE TABLE IF NOT EXISTS "platform"."MessageDeliverySettings" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "emailEnabled" BOOLEAN NOT NULL DEFAULT true,
    "textEnabled" BOOLEAN NOT NULL DEFAULT true,
    "whatsappEnabled" BOOLEAN NOT NULL DEFAULT true,
    "pushEnabled" BOOLEAN NOT NULL DEFAULT true,
    "emailAudience" TEXT NOT NULL DEFAULT 'EVERYONE',
    "textAudience" TEXT NOT NULL DEFAULT 'EVERYONE',
    "pushAudience" TEXT NOT NULL DEFAULT 'EVERYONE',
    "allowedEmails" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "allowedPhones" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "disabledKinds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "heldEmailsTo" TEXT,
    "updatedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "MessageDeliverySettings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "platform"."MessageDeliveryLog" (
    "id" UUID NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "channel" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "recipient" TEXT NOT NULL,
    "subject" TEXT,
    "outcome" TEXT NOT NULL,
    "reason" TEXT,
    CONSTRAINT "MessageDeliveryLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "MessageDeliveryLog_at_idx" ON "platform"."MessageDeliveryLog"("at");
CREATE INDEX IF NOT EXISTS "MessageDeliveryLog_channel_outcome_at_idx" ON "platform"."MessageDeliveryLog"("channel", "outcome", "at");
