-- CreateEnum
CREATE TYPE "service_users"."InitialAssessmentAttachmentCategory" AS ENUM (
  'ASSESSMENT_PICTURE',
  'MCA_DOCUMENT',
  'DISCHARGE_SUMMARY',
  'MEDICATION_LIST',
  'WOUND_PHOTO',
  'EMERGENCY_DOCUMENT',
  'OTHER'
);

-- CreateTable
CREATE TABLE "service_users"."InitialAssessmentAttachment" (
    "id" UUID NOT NULL,
    "submissionId" UUID NOT NULL,
    "serviceUserId" UUID NOT NULL,
    "category" "service_users"."InitialAssessmentAttachmentCategory" NOT NULL,
    "label" TEXT,
    "sectionNumber" INTEGER,
    "fileName" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "uploadedById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "InitialAssessmentAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InitialAssessmentAttachment_submissionId_idx" ON "service_users"."InitialAssessmentAttachment"("submissionId");

-- CreateIndex
CREATE INDEX "InitialAssessmentAttachment_serviceUserId_idx" ON "service_users"."InitialAssessmentAttachment"("serviceUserId");

-- CreateIndex
CREATE INDEX "InitialAssessmentAttachment_deletedAt_idx" ON "service_users"."InitialAssessmentAttachment"("deletedAt");

-- AddForeignKey
ALTER TABLE "service_users"."InitialAssessmentAttachment" ADD CONSTRAINT "InitialAssessmentAttachment_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "service_users"."InitialAssessmentSubmission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_users"."InitialAssessmentAttachment" ADD CONSTRAINT "InitialAssessmentAttachment_serviceUserId_fkey" FOREIGN KEY ("serviceUserId") REFERENCES "service_users"."ServiceUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_users"."InitialAssessmentAttachment" ADD CONSTRAINT "InitialAssessmentAttachment_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "identity"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
