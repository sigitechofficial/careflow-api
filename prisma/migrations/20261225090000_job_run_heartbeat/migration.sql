-- A running job's sign of life, so a run left behind by a stopped process stops blocking the job within minutes
-- instead of an hour (src/jobs/job-runner.service.ts).
ALTER TABLE "platform"."JobRun" ADD COLUMN "heartbeatAt" TIMESTAMP(3);
