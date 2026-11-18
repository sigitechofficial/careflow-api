-- Recruitment step-by-step flow: Application → Screening → Interview → Conditional offer →
-- Pre-employment checks (CQC Schedule 3) → Cleared to start → Hired (converted to an employee).

-- CreateEnum
CREATE TYPE "employees"."CandidateOfferStatus" AS ENUM ('SENT', 'ACCEPTED', 'DECLINED');
CREATE TYPE "employees"."CandidateInterviewMode" AS ENUM ('IN_PERSON', 'PHONE', 'VIDEO');
CREATE TYPE "employees"."CandidateInterviewStatus" AS ENUM ('SCHEDULED', 'COMPLETED', 'CANCELLED', 'NO_SHOW');
CREATE TYPE "employees"."CandidateInterviewOutcome" AS ENUM ('HIRE', 'MAYBE', 'DO_NOT_HIRE');
CREATE TYPE "employees"."CandidateCheckType" AS ENUM ('PROOF_OF_ID', 'RIGHT_TO_WORK', 'DBS', 'REFERENCE_1', 'REFERENCE_2', 'QUALIFICATIONS', 'HEALTH_DECLARATION', 'OVERSEAS_POLICE_CHECK', 'DRIVING');
CREATE TYPE "employees"."CandidateCheckStatus" AS ENUM ('NOT_STARTED', 'REQUESTED', 'RECEIVED', 'VERIFIED', 'FAILED', 'NOT_REQUIRED');

-- AlterEnum
ALTER TYPE "employees"."CandidateDocumentType" ADD VALUE 'OFFER_LETTER';
ALTER TYPE "employees"."CandidateDocumentType" ADD VALUE 'CHECK_EVIDENCE';

-- Fold the removed stages into the simpler flow: Shortlisted and Assessment both become Interview.
-- A candidate at the old "Accepted" (offer accepted) who was never converted goes back to the checks
-- step, so the pre-employment checks are recorded before they can be cleared.
UPDATE "employees"."Candidate" SET "stage" = 'INTERVIEW' WHERE "stage" IN ('SHORTLISTED', 'ASSESSMENT');
UPDATE "employees"."Candidate" SET "stage" = 'VETTING' WHERE "stage" = 'ACCEPTED' AND "convertedEmployeeId" IS NULL;
UPDATE "employees"."CandidateStageHistory" SET "fromStage" = 'INTERVIEW' WHERE "fromStage" IN ('SHORTLISTED', 'ASSESSMENT');
UPDATE "employees"."CandidateStageHistory" SET "toStage" = 'INTERVIEW' WHERE "toStage" IN ('SHORTLISTED', 'ASSESSMENT');

-- AlterEnum
CREATE TYPE "employees"."CandidateStage_new" AS ENUM ('APPLIED', 'SCREENING', 'INTERVIEW', 'OFFER', 'VETTING', 'ACCEPTED', 'REJECTED', 'WITHDRAWN');
ALTER TABLE "employees"."Candidate" ALTER COLUMN "stage" DROP DEFAULT;
ALTER TABLE "employees"."Candidate" ALTER COLUMN "stage" TYPE "employees"."CandidateStage_new" USING ("stage"::text::"employees"."CandidateStage_new");
ALTER TABLE "employees"."CandidateStageHistory" ALTER COLUMN "fromStage" TYPE "employees"."CandidateStage_new" USING ("fromStage"::text::"employees"."CandidateStage_new");
ALTER TABLE "employees"."CandidateStageHistory" ALTER COLUMN "toStage" TYPE "employees"."CandidateStage_new" USING ("toStage"::text::"employees"."CandidateStage_new");
ALTER TYPE "employees"."CandidateStage" RENAME TO "CandidateStage_old";
ALTER TYPE "employees"."CandidateStage_new" RENAME TO "CandidateStage";
DROP TYPE "employees"."CandidateStage_old";
ALTER TABLE "employees"."Candidate" ALTER COLUMN "stage" SET DEFAULT 'APPLIED';

-- AlterTable
ALTER TABLE "employees"."Candidate" ADD COLUMN     "clearanceNotes" TEXT,
ADD COLUMN     "clearedAt" TIMESTAMP(3),
ADD COLUMN     "clearedById" UUID,
ADD COLUMN     "drivesForWork" BOOLEAN,
ADD COLUMN     "employmentHistory" JSONB,
ADD COLUMN     "hasRightToWork" BOOLEAN,
ADD COLUMN     "livedOverseas" BOOLEAN,
ADD COLUMN     "needsSponsorship" BOOLEAN,
ADD COLUMN     "offerHoursPerWeek" TEXT,
ADD COLUMN     "offerNotes" TEXT,
ADD COLUMN     "offerPayRate" TEXT,
ADD COLUMN     "offerRespondedAt" TIMESTAMP(3),
ADD COLUMN     "offerSentAt" TIMESTAMP(3),
ADD COLUMN     "offerStartDate" TIMESTAMP(3),
ADD COLUMN     "offerStatus" "employees"."CandidateOfferStatus",
ADD COLUMN     "outcomeReason" TEXT,
ADD COLUMN     "screeningNotes" TEXT;

-- AlterTable
ALTER TABLE "employees"."CandidateDocument" ADD COLUMN     "checkId" UUID;

-- CreateTable
CREATE TABLE "employees"."CandidateInterview" (
    "id" UUID NOT NULL,
    "candidateId" UUID NOT NULL,
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "mode" "employees"."CandidateInterviewMode" NOT NULL DEFAULT 'IN_PERSON',
    "location" TEXT,
    "interviewers" TEXT,
    "status" "employees"."CandidateInterviewStatus" NOT NULL DEFAULT 'SCHEDULED',
    "answers" JSONB,
    "recommendation" "employees"."CandidateInterviewOutcome",
    "gapsDiscussed" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "completedAt" TIMESTAMP(3),
    "completedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" UUID,
    "updatedById" UUID,

    CONSTRAINT "CandidateInterview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employees"."CandidateCheck" (
    "id" UUID NOT NULL,
    "candidateId" UUID NOT NULL,
    "type" "employees"."CandidateCheckType" NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT true,
    "status" "employees"."CandidateCheckStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "referenceNumber" TEXT,
    "provider" TEXT,
    "issueDate" TIMESTAMP(3),
    "expiryDate" TIMESTAMP(3),
    "notes" TEXT,
    "requestedAt" TIMESTAMP(3),
    "receivedAt" TIMESTAMP(3),
    "verifiedAt" TIMESTAMP(3),
    "verifiedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" UUID,

    CONSTRAINT "CandidateCheck_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CandidateInterview_candidateId_scheduledAt_idx" ON "employees"."CandidateInterview"("candidateId", "scheduledAt");

-- CreateIndex
CREATE UNIQUE INDEX "CandidateCheck_candidateId_type_key" ON "employees"."CandidateCheck"("candidateId", "type");

-- CreateIndex
CREATE INDEX "CandidateDocument_checkId_idx" ON "employees"."CandidateDocument"("checkId");

-- AddForeignKey
ALTER TABLE "employees"."CandidateDocument" ADD CONSTRAINT "CandidateDocument_checkId_fkey" FOREIGN KEY ("checkId") REFERENCES "employees"."CandidateCheck"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees"."CandidateInterview" ADD CONSTRAINT "CandidateInterview_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "employees"."Candidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees"."CandidateCheck" ADD CONSTRAINT "CandidateCheck_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "employees"."Candidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
