-- HR Recruitment Phase 2: vacancies, candidates, pipeline history, notifications

CREATE TYPE "employees"."VacancyStatus" AS ENUM ('OPEN', 'PAUSED', 'CLOSED');
CREATE TYPE "employees"."RecruitmentEmploymentType" AS ENUM (
  'PERMANENT',
  'FIXED_TERM',
  'BANK',
  'AGENCY',
  'APPRENTICE',
  'VOLUNTEER'
);
CREATE TYPE "employees"."CandidateSource" AS ENUM (
  'WEBSITE',
  'REFERRAL',
  'AGENCY',
  'INTERNAL',
  'MANUAL'
);
CREATE TYPE "employees"."CandidateStage" AS ENUM (
  'APPLIED',
  'SCREENING',
  'SHORTLISTED',
  'INTERVIEW',
  'ASSESSMENT',
  'OFFER',
  'VETTING',
  'ACCEPTED',
  'REJECTED',
  'WITHDRAWN'
);
CREATE TYPE "employees"."CandidateDocumentType" AS ENUM (
  'CV',
  'CERTIFICATE',
  'ID_DOCUMENT',
  'OTHER'
);
CREATE TYPE "employees"."CandidateDocumentStatus" AS ENUM (
  'UPLOADED',
  'UNDER_REVIEW',
  'ACCEPTED',
  'REJECTED'
);

CREATE TABLE "employees"."Vacancy" (
  "id" UUID NOT NULL,
  "recordNo" SERIAL NOT NULL,
  "title" TEXT NOT NULL,
  "jobTitleId" UUID,
  "locationId" UUID,
  "employmentType" "employees"."RecruitmentEmploymentType" NOT NULL,
  "description" TEXT,
  "requirements" TEXT,
  "salaryRange" TEXT,
  "numberOfPositions" INTEGER NOT NULL DEFAULT 1,
  "status" "employees"."VacancyStatus" NOT NULL DEFAULT 'OPEN',
  "hiringManagerId" UUID,
  "createdById" UUID,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "deletedAt" TIMESTAMP(3),
  "updatedById" UUID,
  CONSTRAINT "Vacancy_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Vacancy_recordNo_key" ON "employees"."Vacancy"("recordNo");
CREATE INDEX "Vacancy_status_idx" ON "employees"."Vacancy"("status");
CREATE INDEX "Vacancy_hiringManagerId_idx" ON "employees"."Vacancy"("hiringManagerId");
CREATE INDEX "Vacancy_locationId_idx" ON "employees"."Vacancy"("locationId");
CREATE INDEX "Vacancy_deletedAt_idx" ON "employees"."Vacancy"("deletedAt");

ALTER TABLE "employees"."Vacancy"
  ADD CONSTRAINT "Vacancy_jobTitleId_fkey"
  FOREIGN KEY ("jobTitleId") REFERENCES "lookups"."JobTitle"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "employees"."Vacancy"
  ADD CONSTRAINT "Vacancy_locationId_fkey"
  FOREIGN KEY ("locationId") REFERENCES "lookups"."Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "employees"."Vacancy"
  ADD CONSTRAINT "Vacancy_hiringManagerId_fkey"
  FOREIGN KEY ("hiringManagerId") REFERENCES "employees"."Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "employees"."Vacancy"
  ADD CONSTRAINT "Vacancy_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "identity"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "employees"."Candidate" (
  "id" UUID NOT NULL,
  "recordNo" SERIAL NOT NULL,
  "firstName" TEXT NOT NULL,
  "lastName" TEXT NOT NULL,
  "email" TEXT,
  "phone" TEXT,
  "dateOfBirth" TIMESTAMP(3),
  "address" TEXT,
  "vacancyId" UUID NOT NULL,
  "source" "employees"."CandidateSource" NOT NULL,
  "stage" "employees"."CandidateStage" NOT NULL DEFAULT 'APPLIED',
  "coverLetter" TEXT,
  "personalStatement" TEXT,
  "cvFileUrl" TEXT,
  "dataProcessingConsent" BOOLEAN NOT NULL DEFAULT false,
  "consentDate" TIMESTAMP(3),
  "convertedEmployeeId" UUID,
  "convertedAt" TIMESTAMP(3),
  "convertedById" UUID,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "deletedAt" TIMESTAMP(3),
  "createdById" UUID,
  "updatedById" UUID,
  CONSTRAINT "Candidate_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Candidate_recordNo_key" ON "employees"."Candidate"("recordNo");
CREATE UNIQUE INDEX "Candidate_convertedEmployeeId_key" ON "employees"."Candidate"("convertedEmployeeId");
CREATE INDEX "Candidate_vacancyId_idx" ON "employees"."Candidate"("vacancyId");
CREATE INDEX "Candidate_stage_idx" ON "employees"."Candidate"("stage");
CREATE INDEX "Candidate_email_idx" ON "employees"."Candidate"("email");
CREATE INDEX "Candidate_deletedAt_idx" ON "employees"."Candidate"("deletedAt");

ALTER TABLE "employees"."Candidate"
  ADD CONSTRAINT "Candidate_vacancyId_fkey"
  FOREIGN KEY ("vacancyId") REFERENCES "employees"."Vacancy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "employees"."Candidate"
  ADD CONSTRAINT "Candidate_convertedEmployeeId_fkey"
  FOREIGN KEY ("convertedEmployeeId") REFERENCES "employees"."Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "employees"."Candidate"
  ADD CONSTRAINT "Candidate_convertedById_fkey"
  FOREIGN KEY ("convertedById") REFERENCES "identity"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "employees"."CandidateDocument" (
  "id" UUID NOT NULL,
  "candidateId" UUID NOT NULL,
  "documentType" "employees"."CandidateDocumentType" NOT NULL,
  "fileUrl" TEXT NOT NULL,
  "fileName" TEXT NOT NULL,
  "fileSize" INTEGER NOT NULL,
  "mimeType" TEXT NOT NULL,
  "status" "employees"."CandidateDocumentStatus" NOT NULL DEFAULT 'UPLOADED',
  "reviewNotes" TEXT,
  "uploadedById" UUID,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "deletedAt" TIMESTAMP(3),
  "createdById" UUID,
  CONSTRAINT "CandidateDocument_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CandidateDocument_candidateId_idx" ON "employees"."CandidateDocument"("candidateId");
CREATE INDEX "CandidateDocument_deletedAt_idx" ON "employees"."CandidateDocument"("deletedAt");

ALTER TABLE "employees"."CandidateDocument"
  ADD CONSTRAINT "CandidateDocument_candidateId_fkey"
  FOREIGN KEY ("candidateId") REFERENCES "employees"."Candidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "employees"."CandidateDocument"
  ADD CONSTRAINT "CandidateDocument_uploadedById_fkey"
  FOREIGN KEY ("uploadedById") REFERENCES "identity"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "employees"."CandidateStageHistory" (
  "id" UUID NOT NULL,
  "candidateId" UUID NOT NULL,
  "fromStage" "employees"."CandidateStage",
  "toStage" "employees"."CandidateStage" NOT NULL,
  "changedById" UUID,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CandidateStageHistory_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CandidateStageHistory_candidateId_createdAt_idx"
  ON "employees"."CandidateStageHistory"("candidateId", "createdAt");

ALTER TABLE "employees"."CandidateStageHistory"
  ADD CONSTRAINT "CandidateStageHistory_candidateId_fkey"
  FOREIGN KEY ("candidateId") REFERENCES "employees"."Candidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "employees"."CandidateStageHistory"
  ADD CONSTRAINT "CandidateStageHistory_changedById_fkey"
  FOREIGN KEY ("changedById") REFERENCES "identity"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TYPE "notifications"."NotificationType" ADD VALUE IF NOT EXISTS 'HR_APPLICATION_RECEIVED';
ALTER TYPE "notifications"."NotificationType" ADD VALUE IF NOT EXISTS 'HR_CANDIDATE_SHORTLISTED';
ALTER TYPE "notifications"."NotificationType" ADD VALUE IF NOT EXISTS 'HR_INTERVIEW_SCHEDULED';
ALTER TYPE "notifications"."NotificationType" ADD VALUE IF NOT EXISTS 'HR_OFFER_ACCEPTED';

ALTER TYPE "notifications"."NotificationModule" ADD VALUE IF NOT EXISTS 'HR';
