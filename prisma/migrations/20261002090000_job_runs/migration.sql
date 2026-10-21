-- Scheduled jobs (System jobs): run history + exactly-once per (jobName, periodKey).
-- Additive only: one new table in the existing "platform" schema.
CREATE SCHEMA IF NOT EXISTS "platform";

-- CreateTable
CREATE TABLE "platform"."JobRun" (
    "id" UUID NOT NULL,
    "jobName" TEXT NOT NULL,
    "periodKey" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'running',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    "summary" JSONB,
    "error" TEXT,
    "triggeredById" UUID,
    "attempt" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "JobRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "JobRun_jobName_startedAt_idx" ON "platform"."JobRun"("jobName", "startedAt" DESC);

-- CreateIndex
CREATE INDEX "JobRun_status_idx" ON "platform"."JobRun"("status");

-- CreateIndex
CREATE UNIQUE INDEX "JobRun_jobName_periodKey_key" ON "platform"."JobRun"("jobName", "periodKey");
