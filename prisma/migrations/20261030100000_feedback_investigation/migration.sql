-- CreateTable
CREATE TABLE "incidents"."FeedbackInvestigation" (
    "id" UUID NOT NULL,
    "feedbackId" UUID NOT NULL,
    "whatHappened" TEXT,
    "whyHappened" TEXT,
    "contributingFactors" TEXT[],
    "contributingFactorDetails" JSONB,
    "rootCause" TEXT,
    "preventable" "incidents"."IncidentPreventability",
    "conclusion" TEXT,
    "completedAt" TIMESTAMP(3),
    "investigationLevel" VARCHAR(20),
    "leadInvestigatorEmployeeId" UUID,
    "investigatorInvolved" VARCHAR(20),
    "investigatorInvolvedReason" TEXT,
    "targetDate" DATE,
    "termsOfReference" TEXT,
    "investigationStatus" VARCHAR(20) NOT NULL DEFAULT 'IN_PROGRESS',
    "recordsReviewed" TEXT[],
    "recordsReviewedDetails" JSONB,
    "evidenceNotes" TEXT,
    "outstandingEvidence" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" UUID,
    "updatedById" UUID,

    CONSTRAINT "FeedbackInvestigation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "incidents"."FeedbackInvestigationPause" (
    "id" UUID NOT NULL,
    "feedbackId" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "pausedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "pausedById" UUID,
    "nextReviewDate" DATE NOT NULL,
    "resumedAt" TIMESTAMP(3),
    "resumedById" UUID,

    CONSTRAINT "FeedbackInvestigationPause_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FeedbackInvestigation_feedbackId_key" ON "incidents"."FeedbackInvestigation"("feedbackId");

-- CreateIndex
CREATE INDEX "FeedbackInvestigationPause_feedbackId_pausedAt_idx" ON "incidents"."FeedbackInvestigationPause"("feedbackId", "pausedAt");

-- AddForeignKey
ALTER TABLE "incidents"."FeedbackInvestigation" ADD CONSTRAINT "FeedbackInvestigation_feedbackId_fkey" FOREIGN KEY ("feedbackId") REFERENCES "incidents"."FeedbackRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incidents"."FeedbackInvestigationPause" ADD CONSTRAINT "FeedbackInvestigationPause_feedbackId_fkey" FOREIGN KEY ("feedbackId") REFERENCES "incidents"."FeedbackRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;

