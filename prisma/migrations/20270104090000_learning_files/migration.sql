-- Learning: files (image / PDF / Word) attached to lessons. Stored outside the public uploads
-- folder and served only through short-lived signed links. Additive.

CREATE TABLE IF NOT EXISTS "learning"."LearningFile" (
  "id" UUID NOT NULL,
  "originalName" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "fileSize" INTEGER NOT NULL,
  "storagePath" TEXT NOT NULL,
  "uploadedById" UUID,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deletedAt" TIMESTAMP(3),
  CONSTRAINT "LearningFile_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "LearningFile_deletedAt_idx" ON "learning"."LearningFile"("deletedAt");

-- fileId was never written by any upload before this, so any value cannot point at a file.
UPDATE "learning"."LearningContentItem" SET "fileId" = NULL
WHERE "fileId" IS NOT NULL
  AND "fileId" NOT IN (SELECT "id" FROM "learning"."LearningFile");

CREATE INDEX IF NOT EXISTS "LearningContentItem_fileId_idx" ON "learning"."LearningContentItem"("fileId");

DO $$ BEGIN
  ALTER TABLE "learning"."LearningContentItem"
    ADD CONSTRAINT "LearningContentItem_fileId_fkey"
    FOREIGN KEY ("fileId") REFERENCES "learning"."LearningFile"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
