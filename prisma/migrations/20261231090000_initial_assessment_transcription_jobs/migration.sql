-- Speech-to-text jobs for the separate Whisper worker (WHISPER_MODE=azure-job). Not used in the default
-- local mode, where jobs stay in the API's memory. Rows are deleted 2 hours after they finish.
CREATE TABLE "service_users"."InitialAssessmentTranscriptionJob" (
    "id" UUID NOT NULL,
    "submissionId" UUID NOT NULL,
    "serviceUserId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "recordingAttachmentId" UUID NOT NULL,
    "fileName" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "done" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "duration" DOUBLE PRECISION,
    "text" TEXT,
    "language" TEXT,
    "segments" JSONB,
    "error" TEXT,
    "transcriptAttachmentId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "heartbeatAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "InitialAssessmentTranscriptionJob_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "InitialAssessmentTranscriptionJob_status_createdAt_idx" ON "service_users"."InitialAssessmentTranscriptionJob"("status", "createdAt");

CREATE INDEX "InitialAssessmentTranscriptionJob_submissionId_idx" ON "service_users"."InitialAssessmentTranscriptionJob"("submissionId");

ALTER TABLE "service_users"."InitialAssessmentTranscriptionJob" ADD CONSTRAINT "InitialAssessmentTranscriptionJob_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "service_users"."InitialAssessmentSubmission"("id") ON DELETE CASCADE ON UPDATE CASCADE;
