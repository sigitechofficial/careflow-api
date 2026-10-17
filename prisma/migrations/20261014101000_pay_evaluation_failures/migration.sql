-- Payroll remediation, Gate B sprint (R-17 / VW-03).
-- A durable record of every pay calculation that could not be completed, so a visit can no longer
-- be left unpriced with only a line in the server log. Additive: one new table.

-- CreateTable
CREATE TABLE "billing"."PayEvaluationFailure" (
    "id" UUID NOT NULL,
    "subjectKey" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "scheduledJobId" UUID,
    "scheduledVisitId" UUID,
    "visitReconciliationId" UUID,
    "serviceUserId" UUID,
    "employeeId" UUID,
    "visitRef" TEXT,
    "kind" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "context" JSONB,
    "retryable" BOOLEAN NOT NULL DEFAULT true,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "occurrences" INTEGER NOT NULL DEFAULT 1,
    "firstOccurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastOccurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "resolvedById" UUID,
    "resolution" TEXT,
    "history" JSONB NOT NULL DEFAULT '[]',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayEvaluationFailure_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PayEvaluationFailure_subjectKey_key" ON "billing"."PayEvaluationFailure"("subjectKey");

-- CreateIndex
CREATE INDEX "PayEvaluationFailure_status_idx" ON "billing"."PayEvaluationFailure"("status");

-- CreateIndex
CREATE INDEX "PayEvaluationFailure_employeeId_idx" ON "billing"."PayEvaluationFailure"("employeeId");

-- CreateIndex
CREATE INDEX "PayEvaluationFailure_serviceUserId_idx" ON "billing"."PayEvaluationFailure"("serviceUserId");

