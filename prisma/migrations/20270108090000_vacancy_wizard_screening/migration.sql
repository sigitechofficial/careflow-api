-- Vacancy form (Indeed-style): draft status, hours, start date, pay numbers, shifts, benefits,
-- screening questions, CV setting and how the hiring manager hears about applications.
ALTER TYPE "employees"."VacancyStatus" ADD VALUE 'DRAFT' BEFORE 'OPEN';

ALTER TABLE "employees"."Vacancy"
  ADD COLUMN "workSetting" TEXT,
  ADD COLUMN "hoursType" TEXT,
  ADD COLUMN "hoursPerWeekMin" INTEGER,
  ADD COLUMN "hoursPerWeekMax" INTEGER,
  ADD COLUMN "startDate" DATE,
  ADD COLUMN "payMin" DECIMAL(10,2),
  ADD COLUMN "payMax" DECIMAL(10,2),
  ADD COLUMN "shifts" TEXT[] DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "benefits" TEXT[] DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "screeningQuestions" JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN "cvRequirement" TEXT NOT NULL DEFAULT 'OPTIONAL',
  ADD COLUMN "notifyMode" TEXT NOT NULL DEFAULT 'EACH';

-- Candidates: answers to those questions, which ones missed, and the daily summary marker.
ALTER TABLE "employees"."Candidate"
  ADD COLUMN "screeningAnswers" JSONB,
  ADD COLUMN "dealBreakersMissed" TEXT[] DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "summaryEmailedAt" TIMESTAMP(3);
