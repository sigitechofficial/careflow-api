-- Service user assessments registry + completion history
CREATE TYPE "service_users"."AssessmentCompletionSource" AS ENUM ('INITIAL_ASSESSMENT', 'MANUAL', 'CARE_PLAN');

-- CreateTable
CREATE TABLE "service_users"."ServiceUserAssessment" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "serviceUserId" UUID NOT NULL,
    "assessmentKey" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "carePathwayFormId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServiceUserAssessment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_users"."ServiceUserAssessmentCompletion" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "assessmentId" UUID NOT NULL,
    "source" "service_users"."AssessmentCompletionSource" NOT NULL,
    "sourceSubmissionId" UUID,
    "sourceHolisticTabId" INTEGER,
    "carePathwayFormId" UUID,
    "carePlanInstanceId" UUID,
    "completedAt" TIMESTAMP(3) NOT NULL,
    "completedById" UUID,
    "summary" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "promotionKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ServiceUserAssessmentCompletion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_users"."CarePlanAssessmentLink" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "completionId" UUID NOT NULL,
    "carePlanFormId" UUID NOT NULL,
    "serviceUserId" UUID NOT NULL,
    "linkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "linkedById" UUID,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "CarePlanAssessmentLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ServiceUserAssessment_serviceUserId_assessmentKey_key" ON "service_users"."ServiceUserAssessment"("serviceUserId", "assessmentKey");

-- CreateIndex
CREATE INDEX "ServiceUserAssessment_serviceUserId_idx" ON "service_users"."ServiceUserAssessment"("serviceUserId");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceUserAssessmentCompletion_promotionKey_key" ON "service_users"."ServiceUserAssessmentCompletion"("promotionKey");

-- CreateIndex
CREATE INDEX "ServiceUserAssessmentCompletion_assessmentId_idx" ON "service_users"."ServiceUserAssessmentCompletion"("assessmentId");

-- CreateIndex
CREATE INDEX "ServiceUserAssessmentCompletion_sourceSubmissionId_idx" ON "service_users"."ServiceUserAssessmentCompletion"("sourceSubmissionId");

-- CreateIndex
CREATE INDEX "CarePlanAssessmentLink_serviceUserId_idx" ON "service_users"."CarePlanAssessmentLink"("serviceUserId");

-- AddForeignKey
ALTER TABLE "service_users"."ServiceUserAssessment" ADD CONSTRAINT "ServiceUserAssessment_serviceUserId_fkey" FOREIGN KEY ("serviceUserId") REFERENCES "service_users"."ServiceUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_users"."ServiceUserAssessmentCompletion" ADD CONSTRAINT "ServiceUserAssessmentCompletion_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "service_users"."ServiceUserAssessment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_users"."ServiceUserAssessmentCompletion" ADD CONSTRAINT "ServiceUserAssessmentCompletion_sourceSubmissionId_fkey" FOREIGN KEY ("sourceSubmissionId") REFERENCES "service_users"."InitialAssessmentSubmission"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_users"."ServiceUserAssessmentCompletion" ADD CONSTRAINT "ServiceUserAssessmentCompletion_completedById_fkey" FOREIGN KEY ("completedById") REFERENCES "identity"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_users"."CarePlanAssessmentLink" ADD CONSTRAINT "CarePlanAssessmentLink_completionId_fkey" FOREIGN KEY ("completionId") REFERENCES "service_users"."ServiceUserAssessmentCompletion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_users"."CarePlanAssessmentLink" ADD CONSTRAINT "CarePlanAssessmentLink_serviceUserId_fkey" FOREIGN KEY ("serviceUserId") REFERENCES "service_users"."ServiceUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_users"."CarePlanAssessmentLink" ADD CONSTRAINT "CarePlanAssessmentLink_linkedById_fkey" FOREIGN KEY ("linkedById") REFERENCES "identity"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
