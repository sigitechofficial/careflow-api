-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "surveys";

-- CreateEnum
CREATE TYPE "surveys"."SurveyTargetKind" AS ENUM ('EMPLOYEE', 'SERVICE_USER');

-- CreateEnum
CREATE TYPE "surveys"."SurveyStatus" AS ENUM ('DRAFT', 'ACTIVE', 'CLOSED');

-- CreateEnum
CREATE TYPE "surveys"."SurveyQuestionType" AS ENUM ('YES_NO', 'SINGLE_SELECT', 'MULTI_SELECT', 'TEXT', 'TEXTAREA', 'NUMBER', 'RATING', 'LIKERT');

-- CreateEnum
CREATE TYPE "surveys"."SurveyRecipientStatus" AS ENUM ('PENDING', 'SENT', 'STARTED', 'COMPLETED');
-- CreateTable
CREATE TABLE "surveys"."Survey" (
    "id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "targetKind" "surveys"."SurveyTargetKind" NOT NULL DEFAULT 'EMPLOYEE',
    "status" "surveys"."SurveyStatus" NOT NULL DEFAULT 'DRAFT',
    "isAnonymous" BOOLEAN NOT NULL DEFAULT false,
    "opensAt" TIMESTAMP(3),
    "closesAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdById" UUID,
    "updatedById" UUID,
    "deletedById" UUID,

    CONSTRAINT "Survey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "surveys"."SurveyQuestion" (
    "id" UUID NOT NULL,
    "surveyId" UUID NOT NULL,
    "questionText" TEXT NOT NULL,
    "helpText" TEXT,
    "questionType" "surveys"."SurveyQuestionType" NOT NULL,
    "options" JSONB,
    "isRequired" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "config" JSONB,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "SurveyQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "surveys"."SurveyRecipient" (
    "id" UUID NOT NULL,
    "surveyId" UUID NOT NULL,
    "targetKind" "surveys"."SurveyTargetKind" NOT NULL,
    "employeeId" UUID,
    "serviceUserId" UUID,
    "status" "surveys"."SurveyRecipientStatus" NOT NULL DEFAULT 'PENDING',
    "token" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3),
    "remindedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" UUID,

    CONSTRAINT "SurveyRecipient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "surveys"."SurveyResponse" (
    "id" UUID NOT NULL,
    "recipientId" UUID NOT NULL,
    "submittedById" UUID,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SurveyResponse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "surveys"."SurveyAnswer" (
    "id" UUID NOT NULL,
    "responseId" UUID NOT NULL,
    "questionId" UUID NOT NULL,
    "booleanValue" BOOLEAN,
    "textValue" TEXT,
    "numberValue" DECIMAL(12,4),
    "selectedOptions" JSONB,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SurveyAnswer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Survey_targetKind_idx" ON "surveys"."Survey"("targetKind");

-- CreateIndex
CREATE INDEX "Survey_status_idx" ON "surveys"."Survey"("status");

-- CreateIndex
CREATE INDEX "Survey_deletedAt_idx" ON "surveys"."Survey"("deletedAt");

-- CreateIndex
CREATE INDEX "SurveyQuestion_surveyId_idx" ON "surveys"."SurveyQuestion"("surveyId");

-- CreateIndex
CREATE INDEX "SurveyQuestion_deletedAt_idx" ON "surveys"."SurveyQuestion"("deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "SurveyRecipient_token_key" ON "surveys"."SurveyRecipient"("token");

-- CreateIndex
CREATE INDEX "SurveyRecipient_surveyId_idx" ON "surveys"."SurveyRecipient"("surveyId");

-- CreateIndex
CREATE INDEX "SurveyRecipient_employeeId_idx" ON "surveys"."SurveyRecipient"("employeeId");

-- CreateIndex
CREATE INDEX "SurveyRecipient_serviceUserId_idx" ON "surveys"."SurveyRecipient"("serviceUserId");

-- CreateIndex
CREATE INDEX "SurveyRecipient_status_idx" ON "surveys"."SurveyRecipient"("status");

-- CreateIndex
CREATE UNIQUE INDEX "SurveyRecipient_surveyId_employeeId_key" ON "surveys"."SurveyRecipient"("surveyId", "employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "SurveyResponse_recipientId_key" ON "surveys"."SurveyResponse"("recipientId");

-- CreateIndex
CREATE INDEX "SurveyResponse_recipientId_idx" ON "surveys"."SurveyResponse"("recipientId");

-- CreateIndex
CREATE INDEX "SurveyAnswer_responseId_idx" ON "surveys"."SurveyAnswer"("responseId");

-- CreateIndex
CREATE INDEX "SurveyAnswer_questionId_idx" ON "surveys"."SurveyAnswer"("questionId");

-- CreateIndex
CREATE UNIQUE INDEX "SurveyAnswer_responseId_questionId_key" ON "surveys"."SurveyAnswer"("responseId", "questionId");

-- AddForeignKey
ALTER TABLE "surveys"."SurveyQuestion" ADD CONSTRAINT "SurveyQuestion_surveyId_fkey" FOREIGN KEY ("surveyId") REFERENCES "surveys"."Survey"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "surveys"."SurveyRecipient" ADD CONSTRAINT "SurveyRecipient_surveyId_fkey" FOREIGN KEY ("surveyId") REFERENCES "surveys"."Survey"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "surveys"."SurveyResponse" ADD CONSTRAINT "SurveyResponse_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "surveys"."SurveyRecipient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "surveys"."SurveyAnswer" ADD CONSTRAINT "SurveyAnswer_responseId_fkey" FOREIGN KEY ("responseId") REFERENCES "surveys"."SurveyResponse"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "surveys"."SurveyAnswer" ADD CONSTRAINT "SurveyAnswer_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "surveys"."SurveyQuestion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
