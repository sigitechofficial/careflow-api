-- A Google / Microsoft sign-in remembers what the mailbox is for (job applications from the recruitment inbox).
ALTER TABLE "service_users"."ReferralOAuthState" ADD COLUMN "purpose" TEXT NOT NULL DEFAULT 'REFERRALS';
