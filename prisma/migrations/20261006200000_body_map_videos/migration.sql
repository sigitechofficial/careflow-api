-- Carer-app videos attached to body map records (private storage, max 1 per record).
CREATE TABLE "service_users"."BodyMapVideo" (
    "id" UUID NOT NULL,
    "bodyMapRecordId" UUID NOT NULL,
    "scheduledJobId" UUID,
    "clientVideoId" VARCHAR(128) NOT NULL,
    "fileName" VARCHAR(255) NOT NULL,
    "originalName" VARCHAR(255),
    "storagePath" VARCHAR(512) NOT NULL,
    "thumbnailPath" VARCHAR(512),
    "mimeType" VARCHAR(100) NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "durationMs" INTEGER,
    "source" VARCHAR(16),
    "uploadedByEmployeeId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "BodyMapVideo_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BodyMapVideo_bodyMapRecordId_clientVideoId_key" ON "service_users"."BodyMapVideo"("bodyMapRecordId", "clientVideoId");
CREATE INDEX "BodyMapVideo_bodyMapRecordId_idx" ON "service_users"."BodyMapVideo"("bodyMapRecordId");

ALTER TABLE "service_users"."BodyMapVideo" ADD CONSTRAINT "BodyMapVideo_bodyMapRecordId_fkey" FOREIGN KEY ("bodyMapRecordId") REFERENCES "service_users"."BodyMapRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;
