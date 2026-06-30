-- Allow visit-only (ad-hoc) task completions without a planner assignment
ALTER TABLE "scheduling"."ScheduledVisitTaskCompletion"
ALTER COLUMN "assignmentId" DROP NOT NULL;

ALTER TABLE "scheduling"."ScheduledVisitTaskCompletion"
ADD COLUMN IF NOT EXISTS "isAdHoc" BOOLEAN NOT NULL DEFAULT false;

CREATE UNIQUE INDEX IF NOT EXISTS "svtc_job_adhoc_task_uq"
ON "scheduling"."ScheduledVisitTaskCompletion" ("scheduledJobId", "taskCatalogueTaskId")
WHERE "assignmentId" IS NULL;
