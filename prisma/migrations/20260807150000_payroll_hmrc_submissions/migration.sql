-- T16: immutable HMRC RTI submission audit (FPS test gateway).
CREATE TABLE IF NOT EXISTS "payroll"."PayrollHmrcSubmission" (
    "id" UUID NOT NULL,
    "ukPayrollRunId" UUID NOT NULL,
    "documentType" TEXT NOT NULL DEFAULT 'FPS',
    "mode" TEXT NOT NULL,
    "environment" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "correlationId" TEXT,
    "gatewayUserId" TEXT,
    "vendorId" TEXT,
    "submissionUrl" TEXT,
    "requestXmlRedacted" TEXT,
    "responseXml" TEXT,
    "httpStatus" INTEGER,
    "qualifier" TEXT,
    "functionCode" TEXT,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "acknowledgement" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" UUID,

    CONSTRAINT "PayrollHmrcSubmission_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "PayrollHmrcSubmission_ukPayrollRunId_idx"
  ON "payroll"."PayrollHmrcSubmission"("ukPayrollRunId");
CREATE INDEX IF NOT EXISTS "PayrollHmrcSubmission_status_idx"
  ON "payroll"."PayrollHmrcSubmission"("status");
CREATE INDEX IF NOT EXISTS "PayrollHmrcSubmission_createdAt_idx"
  ON "payroll"."PayrollHmrcSubmission"("createdAt");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'PayrollHmrcSubmission_ukPayrollRunId_fkey'
  ) THEN
    ALTER TABLE "payroll"."PayrollHmrcSubmission"
      ADD CONSTRAINT "PayrollHmrcSubmission_ukPayrollRunId_fkey"
      FOREIGN KEY ("ukPayrollRunId") REFERENCES "payroll"."UkPayrollRun"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
