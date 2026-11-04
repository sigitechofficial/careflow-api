-- Enquiry quotations (additive only: new enums/tables, nullable columns).
-- CreateEnum
CREATE TYPE "service_users"."EnquiryQuoteStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'SENT', 'CHANGES_REQUESTED', 'UNDER_NEGOTIATION', 'ACCEPTED', 'DECLINED', 'EXPIRED', 'SUPERSEDED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "service_users"."EnquiryQuoteType" AS ENUM ('PROVISIONAL_ESTIMATE', 'FINAL');

-- CreateEnum
CREATE TYPE "service_users"."EnquiryQuoteFundingCategory" AS ENUM ('PRIVATE', 'LOCAL_AUTHORITY', 'NHS', 'OTHER', 'MIXED');

-- CreateEnum
CREATE TYPE "service_users"."EnquiryQuotePayerType" AS ENUM ('PRIVATE_CLIENT', 'LOCAL_AUTHORITY', 'NHS', 'OTHER');

-- CreateEnum
CREATE TYPE "service_users"."EnquiryQuoteFundingMethod" AS ENUM ('FIXED', 'PERCENTAGE', 'PER_VISIT');

-- CreateEnum
CREATE TYPE "service_users"."EnquiryQuoteFundingStatus" AS ENUM ('CONFIRMED', 'PENDING_APPROVAL');

-- CreateEnum
CREATE TYPE "service_users"."EnquiryQuotePatternFrequency" AS ENUM ('WEEKLY', 'FORTNIGHTLY', 'FOUR_WEEKLY', 'ONE_OFF');

-- CreateEnum
CREATE TYPE "service_users"."EnquiryQuoteExtraKind" AS ENUM ('SETUP_FEE', 'MILEAGE', 'DISCOUNT', 'OTHER');

-- CreateEnum
CREATE TYPE "service_users"."EnquiryQuoteResponseType" AS ENUM ('ACCEPTED', 'DECLINED', 'CHANGES_REQUESTED', 'QUERY', 'NO_RESPONSE');

-- CreateEnum
CREATE TYPE "service_users"."EnquiryQuoteSendChannel" AS ENUM ('EMAIL', 'EXTERNAL_EMAIL', 'POST', 'HAND_DELIVERED', 'OTHER');

-- CreateEnum
CREATE TYPE "service_users"."EnquiryQuoteSendStatus" AS ENUM ('SENT', 'FAILED', 'RECORDED');

-- CreateEnum
CREATE TYPE "service_users"."EnquiryQuoteFollowUpStatus" AS ENUM ('OPEN', 'DONE', 'CANCELLED');

-- AlterTable
ALTER TABLE "service_users"."Enquiry" ADD COLUMN     "legacyQuoteReconcileNote" TEXT,
ADD COLUMN     "legacyQuoteReconciledAt" TIMESTAMP(3),
ADD COLUMN     "legacyQuoteReconciledById" UUID;

-- AlterTable
ALTER TABLE "service_users"."EnquiryEvent" ADD COLUMN     "quotationVersionId" UUID;

-- AlterTable
ALTER TABLE "service_users"."ServiceUserVisitPlan" ADD COLUMN     "sourceEnquiryQuotationId" UUID,
ADD COLUMN     "sourceEnquiryQuotationVersionId" UUID;

-- CreateTable
CREATE TABLE "service_users"."EnquiryQuotation" (
    "id" UUID NOT NULL,
    "enquiryId" UUID NOT NULL,
    "quotationNumber" TEXT NOT NULL,
    "isCurrent" BOOLEAN NOT NULL DEFAULT true,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "EnquiryQuotation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_users"."EnquiryQuotationNumberSequence" (
    "year" INTEGER NOT NULL,
    "lastValue" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EnquiryQuotationNumberSequence_pkey" PRIMARY KEY ("year")
);

-- CreateTable
CREATE TABLE "service_users"."EnquiryQuotationVersion" (
    "id" UUID NOT NULL,
    "quotationId" UUID NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "status" "service_users"."EnquiryQuoteStatus" NOT NULL DEFAULT 'DRAFT',
    "quoteType" "service_users"."EnquiryQuoteType" NOT NULL DEFAULT 'PROVISIONAL_ESTIMATE',
    "revisedFromVersionId" UUID,
    "locationId" UUID,
    "ownerId" UUID,
    "proposedStartDate" DATE,
    "proposedEndDate" DATE,
    "issueDate" DATE,
    "validUntil" DATE,
    "currency" TEXT NOT NULL DEFAULT 'GBP',
    "assessmentSubmissionId" UUID,
    "assessmentReference" TEXT,
    "fundingCategory" "service_users"."EnquiryQuoteFundingCategory" NOT NULL DEFAULT 'PRIVATE',
    "chargeCardId" UUID,
    "internalNotes" TEXT,
    "clientNotes" TEXT,
    "terms" TEXT,
    "weeklyTotal" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "fourWeeklyTotal" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "monthlyAverageTotal" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "annualTotal" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "calendarMonthTotal" DECIMAL(12,2),
    "oneOffTotal" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "vatWeekly" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "clientWeeklyLiability" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "weeklyCoverageMinutes" INTEGER NOT NULL DEFAULT 0,
    "weeklyCarerMinutes" INTEGER NOT NULL DEFAULT 0,
    "unresolvedCharges" INTEGER NOT NULL DEFAULT 0,
    "calculatedAt" TIMESTAMP(3),
    "pricingSnapshot" JSONB,
    "issuedAt" TIMESTAMP(3),
    "issuedById" UUID,
    "submittedForApprovalAt" TIMESTAMP(3),
    "submittedForApprovalById" UUID,
    "approvedAt" TIMESTAMP(3),
    "approvedById" UUID,
    "approvalNote" TEXT,
    "sentAt" TIMESTAMP(3),
    "respondedAt" TIMESTAMP(3),
    "acceptedAt" TIMESTAMP(3),
    "agreementReceivedAt" TIMESTAMP(3),
    "agreementRecordedById" UUID,
    "agreementNote" TEXT,
    "convertedVisitPlanId" UUID,
    "convertedAt" TIMESTAMP(3),
    "convertedById" UUID,
    "statusChangedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" UUID,
    "updatedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EnquiryQuotationVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_users"."EnquiryQuotationVisitPattern" (
    "id" UUID NOT NULL,
    "versionId" UUID NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "label" TEXT NOT NULL,
    "careType" TEXT,
    "startTime" TEXT NOT NULL,
    "endTime" TEXT,
    "windowEndTime" TEXT,
    "durationMinutes" INTEGER NOT NULL,
    "daysOfWeek" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "frequency" "service_users"."EnquiryQuotePatternFrequency" NOT NULL DEFAULT 'WEEKLY',
    "effectiveFrom" DATE,
    "effectiveTo" DATE,
    "oneOffDates" DATE[],
    "carersPerVisit" INTEGER NOT NULL DEFAULT 1,
    "nightDuty" "service_users"."VisitPlanNightDuty" NOT NULL DEFAULT 'NONE',
    "activities" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "notes" TEXT,
    "manualChargePerVisit" DECIMAL(12,2),
    "overrideReason" TEXT,
    "overrideById" UUID,
    "overrideAt" TIMESTAMP(3),
    "rateReference" TEXT,
    "chargePerOccurrence" DECIMAL(12,2),
    "weeklyOccurrences" DECIMAL(8,3) NOT NULL DEFAULT 0,
    "weeklyCoverageMinutes" INTEGER NOT NULL DEFAULT 0,
    "weeklyCarerMinutes" INTEGER NOT NULL DEFAULT 0,
    "weeklyTotal" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "pricingIssue" TEXT,

    CONSTRAINT "EnquiryQuotationVisitPattern_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_users"."EnquiryQuotationFunding" (
    "id" UUID NOT NULL,
    "versionId" UUID NOT NULL,
    "payerType" "service_users"."EnquiryQuotePayerType" NOT NULL,
    "payerName" TEXT,
    "funderId" UUID,
    "reference" TEXT,
    "method" "service_users"."EnquiryQuoteFundingMethod" NOT NULL DEFAULT 'FIXED',
    "amount" DECIMAL(12,2) NOT NULL,
    "status" "service_users"."EnquiryQuoteFundingStatus" NOT NULL DEFAULT 'PENDING_APPROVAL',
    "weeklyAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "EnquiryQuotationFunding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_users"."EnquiryQuotationExtra" (
    "id" UUID NOT NULL,
    "versionId" UUID NOT NULL,
    "kind" "service_users"."EnquiryQuoteExtraKind" NOT NULL,
    "description" TEXT NOT NULL,
    "frequency" "service_users"."QuotationChargeFrequency" NOT NULL DEFAULT 'WEEKLY',
    "amount" DECIMAL(12,2),
    "quantity" DECIMAL(10,2),
    "isPercentage" BOOLEAN NOT NULL DEFAULT false,
    "total" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "EnquiryQuotationExtra_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_users"."EnquiryQuotationCommunication" (
    "id" UUID NOT NULL,
    "quotationId" UUID NOT NULL,
    "versionId" UUID NOT NULL,
    "channel" "service_users"."EnquiryQuoteSendChannel" NOT NULL,
    "status" "service_users"."EnquiryQuoteSendStatus" NOT NULL,
    "recipientName" TEXT,
    "recipientEmail" TEXT,
    "template" TEXT,
    "subject" TEXT,
    "message" TEXT,
    "senderId" UUID,
    "sentAt" TIMESTAMP(3),
    "failureReason" TEXT,
    "attemptCount" INTEGER NOT NULL DEFAULT 1,
    "providerMessageId" TEXT,
    "followUpDate" TIMESTAMP(3),
    "idempotencyKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EnquiryQuotationCommunication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_users"."EnquiryQuotationResponse" (
    "id" UUID NOT NULL,
    "quotationId" UUID NOT NULL,
    "versionId" UUID NOT NULL,
    "responseType" "service_users"."EnquiryQuoteResponseType" NOT NULL,
    "responderName" TEXT,
    "responderRelationship" TEXT,
    "method" TEXT,
    "respondedAt" TIMESTAMP(3) NOT NULL,
    "details" TEXT,
    "evidence" TEXT,
    "declineReasonCode" "service_users"."EnquiryLostReason",
    "nextAction" TEXT,
    "createdVersionId" UUID,
    "recordedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EnquiryQuotationResponse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_users"."EnquiryQuotationFollowUp" (
    "id" UUID NOT NULL,
    "quotationId" UUID NOT NULL,
    "versionId" UUID,
    "assigneeId" UUID,
    "method" TEXT,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "note" TEXT,
    "status" "service_users"."EnquiryQuoteFollowUpStatus" NOT NULL DEFAULT 'OPEN',
    "completedAt" TIMESTAMP(3),
    "completedById" UUID,
    "outcome" TEXT,
    "rescheduledFromId" UUID,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EnquiryQuotationFollowUp_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EnquiryQuotation_quotationNumber_key" ON "service_users"."EnquiryQuotation"("quotationNumber");

-- CreateIndex
CREATE INDEX "EnquiryQuotation_enquiryId_idx" ON "service_users"."EnquiryQuotation"("enquiryId");

-- CreateIndex
CREATE INDEX "EnquiryQuotationVersion_status_idx" ON "service_users"."EnquiryQuotationVersion"("status");

-- CreateIndex
CREATE INDEX "EnquiryQuotationVersion_locationId_idx" ON "service_users"."EnquiryQuotationVersion"("locationId");

-- CreateIndex
CREATE UNIQUE INDEX "EnquiryQuotationVersion_quotationId_versionNumber_key" ON "service_users"."EnquiryQuotationVersion"("quotationId", "versionNumber");

-- CreateIndex
CREATE INDEX "EnquiryQuotationVisitPattern_versionId_idx" ON "service_users"."EnquiryQuotationVisitPattern"("versionId");

-- CreateIndex
CREATE INDEX "EnquiryQuotationFunding_versionId_idx" ON "service_users"."EnquiryQuotationFunding"("versionId");

-- CreateIndex
CREATE INDEX "EnquiryQuotationExtra_versionId_idx" ON "service_users"."EnquiryQuotationExtra"("versionId");

-- CreateIndex
CREATE UNIQUE INDEX "EnquiryQuotationCommunication_idempotencyKey_key" ON "service_users"."EnquiryQuotationCommunication"("idempotencyKey");

-- CreateIndex
CREATE INDEX "EnquiryQuotationCommunication_quotationId_idx" ON "service_users"."EnquiryQuotationCommunication"("quotationId");

-- CreateIndex
CREATE INDEX "EnquiryQuotationCommunication_versionId_idx" ON "service_users"."EnquiryQuotationCommunication"("versionId");

-- CreateIndex
CREATE INDEX "EnquiryQuotationResponse_quotationId_idx" ON "service_users"."EnquiryQuotationResponse"("quotationId");

-- CreateIndex
CREATE INDEX "EnquiryQuotationResponse_versionId_idx" ON "service_users"."EnquiryQuotationResponse"("versionId");

-- CreateIndex
CREATE INDEX "EnquiryQuotationFollowUp_quotationId_idx" ON "service_users"."EnquiryQuotationFollowUp"("quotationId");

-- CreateIndex
CREATE INDEX "EnquiryQuotationFollowUp_status_dueAt_idx" ON "service_users"."EnquiryQuotationFollowUp"("status", "dueAt");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceUserVisitPlan_sourceEnquiryQuotationVersionId_key" ON "service_users"."ServiceUserVisitPlan"("sourceEnquiryQuotationVersionId");

-- AddForeignKey
ALTER TABLE "service_users"."EnquiryQuotation" ADD CONSTRAINT "EnquiryQuotation_enquiryId_fkey" FOREIGN KEY ("enquiryId") REFERENCES "service_users"."Enquiry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_users"."EnquiryQuotationVersion" ADD CONSTRAINT "EnquiryQuotationVersion_quotationId_fkey" FOREIGN KEY ("quotationId") REFERENCES "service_users"."EnquiryQuotation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_users"."EnquiryQuotationVisitPattern" ADD CONSTRAINT "EnquiryQuotationVisitPattern_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "service_users"."EnquiryQuotationVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_users"."EnquiryQuotationFunding" ADD CONSTRAINT "EnquiryQuotationFunding_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "service_users"."EnquiryQuotationVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_users"."EnquiryQuotationExtra" ADD CONSTRAINT "EnquiryQuotationExtra_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "service_users"."EnquiryQuotationVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_users"."EnquiryQuotationCommunication" ADD CONSTRAINT "EnquiryQuotationCommunication_quotationId_fkey" FOREIGN KEY ("quotationId") REFERENCES "service_users"."EnquiryQuotation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_users"."EnquiryQuotationResponse" ADD CONSTRAINT "EnquiryQuotationResponse_quotationId_fkey" FOREIGN KEY ("quotationId") REFERENCES "service_users"."EnquiryQuotation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_users"."EnquiryQuotationFollowUp" ADD CONSTRAINT "EnquiryQuotationFollowUp_quotationId_fkey" FOREIGN KEY ("quotationId") REFERENCES "service_users"."EnquiryQuotation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

