-- Referral mailbox: lock per mailbox check, automatic read retries, sign-in state in the database.
ALTER TABLE "service_users"."ReferralMailbox" ADD COLUMN IF NOT EXISTS "checkLockedUntil" TIMESTAMP(3);
ALTER TABLE "service_users"."ReferralEmail" ADD COLUMN IF NOT EXISTS "readAttempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "service_users"."ReferralEmail" ADD COLUMN IF NOT EXISTS "nextReadAt" TIMESTAMP(3);
CREATE INDEX IF NOT EXISTS "ReferralEmail_nextReadAt_idx" ON "service_users"."ReferralEmail"("nextReadAt");

CREATE TABLE IF NOT EXISTS "service_users"."ReferralOAuthState" (
    "stateHash" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "userId" UUID NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ReferralOAuthState_pkey" PRIMARY KEY ("stateHash")
);
CREATE INDEX IF NOT EXISTS "ReferralOAuthState_expiresAt_idx" ON "service_users"."ReferralOAuthState"("expiresAt");
