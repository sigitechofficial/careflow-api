-- T21: append-only HMRC submission audit events + preserve submissions if a run is deleted.

ALTER TABLE "payroll"."PayrollHmrcSubmission"
  DROP CONSTRAINT IF EXISTS "PayrollHmrcSubmission_ukPayrollRunId_fkey";

ALTER TABLE "payroll"."PayrollHmrcSubmission"
  ADD CONSTRAINT "PayrollHmrcSubmission_ukPayrollRunId_fkey"
  FOREIGN KEY ("ukPayrollRunId") REFERENCES "payroll"."UkPayrollRun"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "payroll"."PayrollHmrcSubmissionEvent" (
    "id" UUID NOT NULL,
    "submissionId" UUID NOT NULL,
    "eventType" TEXT NOT NULL,
    "actorUserId" UUID,
    "fromStatus" TEXT,
    "toStatus" TEXT NOT NULL,
    "payloadFingerprint" TEXT,
    "correlationId" TEXT,
    "responseSha256" TEXT,
    "httpStatus" INTEGER,
    "detail" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PayrollHmrcSubmissionEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "PayrollHmrcSubmissionEvent_submissionId_createdAt_idx"
  ON "payroll"."PayrollHmrcSubmissionEvent"("submissionId", "createdAt");

CREATE INDEX IF NOT EXISTS "PayrollHmrcSubmissionEvent_eventType_idx"
  ON "payroll"."PayrollHmrcSubmissionEvent"("eventType");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'PayrollHmrcSubmissionEvent_submissionId_fkey'
  ) THEN
    ALTER TABLE "payroll"."PayrollHmrcSubmissionEvent"
      ADD CONSTRAINT "PayrollHmrcSubmissionEvent_submissionId_fkey"
      FOREIGN KEY ("submissionId") REFERENCES "payroll"."PayrollHmrcSubmission"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;
