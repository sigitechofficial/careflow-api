-- CreateEnum
CREATE TYPE "incidents"."SafeguardingStatus" AS ENUM ('RAISED', 'SCREENING', 'INVESTIGATING', 'REFERRED', 'CLOSED');

-- CreateEnum
CREATE TYPE "incidents"."SafeguardingRisk" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateEnum
CREATE TYPE "incidents"."SafeguardingCategory" AS ENUM ('PHYSICAL', 'EMOTIONAL', 'SEXUAL', 'FINANCIAL', 'NEGLECT', 'SELF_NEGLECT', 'DISCRIMINATORY', 'ORGANISATIONAL', 'DOMESTIC_ABUSE', 'MODERN_SLAVERY', 'OTHER');

-- CreateEnum
CREATE TYPE "incidents"."SafeguardingReferralDecision" AS ENUM ('NOT_REQUIRED', 'PENDING', 'MADE');

-- CreateTable
CREATE TABLE "incidents"."SafeguardingCase" (
    "id" UUID NOT NULL,
    "referenceNumber" TEXT NOT NULL,
    "status" "incidents"."SafeguardingStatus" NOT NULL DEFAULT 'RAISED',
    "category" "incidents"."SafeguardingCategory" NOT NULL,
    "riskLevel" "incidents"."SafeguardingRisk" NOT NULL DEFAULT 'MEDIUM',
    "aboutServiceUserId" UUID,
    "personDescription" TEXT,
    "locationId" UUID,
    "handlerEmployeeId" UUID,
    "raisedByRole" TEXT,
    "raisedAt" TIMESTAMP(3) NOT NULL,
    "description" TEXT NOT NULL,
    "immediateAction" TEXT,
    "laReferral" "incidents"."SafeguardingReferralDecision" NOT NULL DEFAULT 'PENDING',
    "laReference" TEXT,
    "laReferredAt" TIMESTAMP(3),
    "cqcNotified" "incidents"."SafeguardingReferralDecision" NOT NULL DEFAULT 'PENDING',
    "cqcReference" TEXT,
    "outcome" TEXT,
    "lessonsLearned" TEXT,
    "closedAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "recordedById" UUID,
    "deletedById" UUID,

    CONSTRAINT "SafeguardingCase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "incidents"."SafeguardingEvent" (
    "id" UUID NOT NULL,
    "caseId" UUID NOT NULL,
    "action" TEXT NOT NULL,
    "note" TEXT,
    "userId" UUID,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SafeguardingEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "incidents"."SafeguardingNumberSequence" (
    "year" INTEGER NOT NULL,
    "lastValue" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SafeguardingNumberSequence_pkey" PRIMARY KEY ("year")
);

-- CreateIndex
CREATE UNIQUE INDEX "SafeguardingCase_referenceNumber_key" ON "incidents"."SafeguardingCase"("referenceNumber");

-- CreateIndex
CREATE INDEX "SafeguardingCase_status_idx" ON "incidents"."SafeguardingCase"("status");

-- CreateIndex
CREATE INDEX "SafeguardingCase_category_idx" ON "incidents"."SafeguardingCase"("category");

-- CreateIndex
CREATE INDEX "SafeguardingCase_aboutServiceUserId_idx" ON "incidents"."SafeguardingCase"("aboutServiceUserId");

-- CreateIndex
CREATE INDEX "SafeguardingCase_deletedAt_idx" ON "incidents"."SafeguardingCase"("deletedAt");

-- CreateIndex
CREATE INDEX "SafeguardingEvent_caseId_idx" ON "incidents"."SafeguardingEvent"("caseId");

-- AddForeignKey
ALTER TABLE "incidents"."SafeguardingEvent" ADD CONSTRAINT "SafeguardingEvent_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "incidents"."SafeguardingCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

