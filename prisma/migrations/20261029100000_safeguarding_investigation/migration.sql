-- CreateTable
CREATE TABLE "incidents"."SafeguardingInvestigation" (
    "id" UUID NOT NULL,
    "caseId" UUID NOT NULL,
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

    CONSTRAINT "SafeguardingInvestigation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "incidents"."SafeguardingInvestigationPause" (
    "id" UUID NOT NULL,
    "caseId" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "pausedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "pausedById" UUID,
    "nextReviewDate" DATE NOT NULL,
    "resumedAt" TIMESTAMP(3),
    "resumedById" UUID,

    CONSTRAINT "SafeguardingInvestigationPause_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SafeguardingInvestigation_caseId_key" ON "incidents"."SafeguardingInvestigation"("caseId");

-- CreateIndex
CREATE INDEX "SafeguardingInvestigationPause_caseId_pausedAt_idx" ON "incidents"."SafeguardingInvestigationPause"("caseId", "pausedAt");

-- AddForeignKey
ALTER TABLE "incidents"."SafeguardingInvestigation" ADD CONSTRAINT "SafeguardingInvestigation_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "incidents"."SafeguardingCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incidents"."SafeguardingInvestigationPause" ADD CONSTRAINT "SafeguardingInvestigationPause_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "incidents"."SafeguardingCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

