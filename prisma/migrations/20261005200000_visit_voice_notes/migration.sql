-- Carer voice notes (audio) attached to visit log entries (visit note / handover / concern).
CREATE TABLE "scheduling"."VisitVoiceNote" (
    "id" UUID NOT NULL,
    "scheduledJobId" UUID NOT NULL,
    "logEntryId" VARCHAR(128) NOT NULL,
    "entryType" VARCHAR(32) NOT NULL,
    "clientVoiceNoteId" VARCHAR(128) NOT NULL,
    "fileName" VARCHAR(255) NOT NULL,
    "originalName" VARCHAR(255),
    "storagePath" VARCHAR(512) NOT NULL,
    "mimeType" VARCHAR(100) NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "durationMs" INTEGER,
    "recordedAt" TIMESTAMP(3),
    "uploadedByEmployeeId" UUID,
    "idempotencyKey" VARCHAR(128) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "VisitVoiceNote_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "VisitVoiceNote_idempotencyKey_key" ON "scheduling"."VisitVoiceNote"("idempotencyKey");
CREATE UNIQUE INDEX "VisitVoiceNote_scheduledJobId_clientVoiceNoteId_key" ON "scheduling"."VisitVoiceNote"("scheduledJobId", "clientVoiceNoteId");
CREATE INDEX "VisitVoiceNote_scheduledJobId_logEntryId_idx" ON "scheduling"."VisitVoiceNote"("scheduledJobId", "logEntryId");

ALTER TABLE "scheduling"."VisitVoiceNote" ADD CONSTRAINT "VisitVoiceNote_scheduledJobId_fkey" FOREIGN KEY ("scheduledJobId") REFERENCES "scheduling"."ScheduledJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;
