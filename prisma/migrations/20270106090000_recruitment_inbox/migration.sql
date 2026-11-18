-- Recruitment inbox: mailboxes can be for job applications, read into RecruitmentEmail.
ALTER TYPE "employees"."CandidateSource" ADD VALUE 'EMAIL';

ALTER TABLE "service_users"."ReferralMailbox" ADD COLUMN "purpose" TEXT NOT NULL DEFAULT 'REFERRALS';

CREATE TYPE "employees"."RecruitmentEmailStatus" AS ENUM ('RECEIVED', 'READ', 'FAILED', 'NOT_AN_APPLICATION', 'CANDIDATE_CREATED', 'DISMISSED');

CREATE TABLE "employees"."RecruitmentEmail" (
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
    "status" "employees"."RecruitmentEmailStatus" NOT NULL DEFAULT 'RECEIVED',
    "extraction" JSONB,
    "extractionModel" TEXT,
    "extractionCostUsd" DOUBLE PRECISION,
    "error" TEXT,
    "readAttempts" INTEGER NOT NULL DEFAULT 0,
    "candidateId" UUID,
    "handledById" UUID,
    "handledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RecruitmentEmail_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RecruitmentEmail_mailboxId_providerMessageId_key" ON "employees"."RecruitmentEmail"("mailboxId", "providerMessageId");
CREATE INDEX "RecruitmentEmail_status_idx" ON "employees"."RecruitmentEmail"("status");
CREATE INDEX "RecruitmentEmail_receivedAt_idx" ON "employees"."RecruitmentEmail"("receivedAt");
CREATE INDEX "RecruitmentEmail_fromEmail_idx" ON "employees"."RecruitmentEmail"("fromEmail");

ALTER TABLE "employees"."RecruitmentEmail" ADD CONSTRAINT "RecruitmentEmail_mailboxId_fkey" FOREIGN KEY ("mailboxId") REFERENCES "service_users"."ReferralMailbox"("id") ON DELETE CASCADE ON UPDATE CASCADE;
