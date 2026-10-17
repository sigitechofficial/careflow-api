-- TR-01 / TR-04 / TR-05 / TR-06 and Q13: classified travel-time intervals, and pay for visits that
-- do not go ahead as planned. Three new tables; no existing table or row is changed.
--  * TravelTimeInterval: time before a visit classified by a person. Only an approved interval
--    changes pay; with none, the earlier estimate from the gap between visits still applies.
--  * VisitDisruptionPayRule: the employer's rules (none are created here: no policy is invented).
--  * VisitDisruptionPayDecision: one event for one carer, and what was decided to pay for it.
-- Rollback: drop the three tables. Decisions already paid stay paid through their pay items.

-- CreateTable
CREATE TABLE "billing"."TravelTimeInterval" (
    "id" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "toVisitReconciliationId" UUID NOT NULL,
    "fromVisitReconciliationId" UUID,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "minutes" INTEGER NOT NULL,
    "category" TEXT NOT NULL,
    "evidence" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "payable" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedById" UUID,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TravelTimeInterval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing"."VisitDisruptionPayRule" (
    "id" UUID NOT NULL,
    "eventType" TEXT NOT NULL,
    "noticeBelowMinutes" INTEGER,
    "outcome" TEXT NOT NULL,
    "percent" DECIMAL(5,2),
    "fixedAmount" DECIMAL(12,2),
    "effectiveFrom" DATE NOT NULL,
    "effectiveTo" DATE,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "isSynthetic" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedById" UUID,
    "approvedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VisitDisruptionPayRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing"."VisitDisruptionPayDecision" (
    "id" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "scheduledJobId" UUID,
    "visitReconciliationId" UUID,
    "eventType" TEXT NOT NULL,
    "eventAt" TIMESTAMP(3) NOT NULL,
    "noticeMinutes" INTEGER,
    "scheduledMinutes" INTEGER,
    "affectedMinutes" INTEGER,
    "hourlyRate" DECIMAL(12,4),
    "ruleId" UUID,
    "proposedOutcome" TEXT NOT NULL,
    "proposedAmount" DECIMAL(12,2),
    "amount" DECIMAL(12,2),
    "status" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "decisionNote" TEXT,
    "payItemId" UUID,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedById" UUID,
    "decidedAt" TIMESTAMP(3),
    "approvedById" UUID,
    "approvedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VisitDisruptionPayDecision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TravelTimeInterval_toVisitReconciliationId_status_idx" ON "billing"."TravelTimeInterval"("toVisitReconciliationId", "status");

-- CreateIndex
CREATE INDEX "TravelTimeInterval_employeeId_startAt_idx" ON "billing"."TravelTimeInterval"("employeeId", "startAt");

-- CreateIndex
CREATE INDEX "VisitDisruptionPayRule_eventType_status_effectiveFrom_idx" ON "billing"."VisitDisruptionPayRule"("eventType", "status", "effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "VisitDisruptionPayDecision_payItemId_key" ON "billing"."VisitDisruptionPayDecision"("payItemId");

-- CreateIndex
CREATE INDEX "VisitDisruptionPayDecision_employeeId_eventAt_idx" ON "billing"."VisitDisruptionPayDecision"("employeeId", "eventAt");

-- CreateIndex
CREATE INDEX "VisitDisruptionPayDecision_scheduledJobId_idx" ON "billing"."VisitDisruptionPayDecision"("scheduledJobId");

-- CreateIndex
CREATE INDEX "VisitDisruptionPayDecision_status_idx" ON "billing"."VisitDisruptionPayDecision"("status");

