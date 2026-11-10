-- Referrals mailbox: mailboxes CareFlow reads referral emails from, and the emails received.
-- CreateEnum
CREATE TYPE "service_users"."ReferralMailboxProvider" AS ENUM ('GMAIL', 'MICROSOFT');

-- CreateEnum
CREATE TYPE "service_users"."ReferralEmailStatus" AS ENUM ('RECEIVED', 'READ', 'FAILED', 'NOT_A_REFERRAL', 'ENQUIRY_CREATED', 'DISMISSED');

-- CreateTable
CREATE TABLE "service_users"."ReferralMailbox" (
    "id" UUID NOT NULL,
    "provider" "service_users"."ReferralMailboxProvider" NOT NULL,
    "emailAddress" TEXT NOT NULL,
    "encryptedRefreshToken" TEXT NOT NULL,
    "labelName" TEXT NOT NULL DEFAULT 'Referrals',
    "processedLabelId" TEXT,
    "lastCheckedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "connectedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReferralMailbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_users"."ReferralEmail" (
    "id" UUID NOT NULL,
    "mailboxId" UUID NOT NULL,
    "providerMessageId" TEXT NOT NULL,
    "providerThreadId" TEXT,
    "fromName" TEXT,
    "fromEmail" TEXT,
    "subject" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "bodyText" TEXT NOT NULL,
    "attachments" JSONB NOT NULL DEFAULT '[]',
    "status" "service_users"."ReferralEmailStatus" NOT NULL DEFAULT 'RECEIVED',
    "extraction" JSONB,
    "extractionModel" TEXT,
    "extractionCostUsd" DOUBLE PRECISION,
    "error" TEXT,
    "enquiryId" UUID,
    "handledById" UUID,
    "handledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReferralEmail_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ReferralMailbox_isActive_idx" ON "service_users"."ReferralMailbox"("isActive");

-- CreateIndex
CREATE INDEX "ReferralEmail_status_idx" ON "service_users"."ReferralEmail"("status");

-- CreateIndex
CREATE INDEX "ReferralEmail_receivedAt_idx" ON "service_users"."ReferralEmail"("receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ReferralEmail_mailboxId_providerMessageId_key" ON "service_users"."ReferralEmail"("mailboxId", "providerMessageId");

-- AddForeignKey
ALTER TABLE "service_users"."ReferralEmail" ADD CONSTRAINT "ReferralEmail_mailboxId_fkey" FOREIGN KEY ("mailboxId") REFERENCES "service_users"."ReferralMailbox"("id") ON DELETE CASCADE ON UPDATE CASCADE;
