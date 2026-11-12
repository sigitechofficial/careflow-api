-- Interview invitation emails to the candidate: when they were last emailed, and the calendar update number.
ALTER TABLE "employees"."CandidateInterview" ADD COLUMN "candidateEmailedAt" TIMESTAMP(3),
ADD COLUMN "calendarSequence" INTEGER NOT NULL DEFAULT 0;
