-- Task catalogue (master list) and per-service-user visit task assignments

CREATE TABLE IF NOT EXISTS "service_users"."TaskCatalogueGroup" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "source" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "TaskCatalogueGroup_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "service_users"."TaskCatalogueCategory" (
    "id" UUID NOT NULL,
    "groupId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "TaskCatalogueCategory_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "service_users"."TaskCatalogueTask" (
    "id" UUID NOT NULL,
    "categoryId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "supportLevelApplicable" BOOLEAN NOT NULL DEFAULT false,
    "consentRequired" BOOLEAN NOT NULL DEFAULT false,
    "competencyGated" BOOLEAN NOT NULL DEFAULT false,
    "competency" TEXT,
    "outOfScope" BOOLEAN NOT NULL DEFAULT false,
    "flagsJson" JSONB,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "TaskCatalogueTask_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "service_users"."ServiceUserVisitTaskAssignment" (
    "id" UUID NOT NULL,
    "serviceUserId" UUID NOT NULL,
    "medicationRoundCode" TEXT NOT NULL,
    "taskCatalogueTaskId" UUID NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdById" UUID,
    "updatedById" UUID,

    CONSTRAINT "ServiceUserVisitTaskAssignment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "scheduling"."ScheduledVisitTaskCompletion" (
    "id" UUID NOT NULL,
    "scheduledJobId" UUID NOT NULL,
    "assignmentId" UUID NOT NULL,
    "taskCatalogueTaskId" UUID NOT NULL,
    "medicationRoundCode" TEXT NOT NULL,
    "isCompleted" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "completedAt" TIMESTAMP(3),
    "completedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScheduledVisitTaskCompletion_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "TaskCatalogueGroup_code_key" ON "service_users"."TaskCatalogueGroup"("code");
CREATE INDEX IF NOT EXISTS "TaskCatalogueGroup_deletedAt_idx" ON "service_users"."TaskCatalogueGroup"("deletedAt");
CREATE INDEX IF NOT EXISTS "TaskCatalogueGroup_isActive_idx" ON "service_users"."TaskCatalogueGroup"("isActive");

CREATE INDEX IF NOT EXISTS "TaskCatalogueCategory_groupId_idx" ON "service_users"."TaskCatalogueCategory"("groupId");
CREATE INDEX IF NOT EXISTS "TaskCatalogueCategory_deletedAt_idx" ON "service_users"."TaskCatalogueCategory"("deletedAt");
CREATE INDEX IF NOT EXISTS "TaskCatalogueCategory_isActive_idx" ON "service_users"."TaskCatalogueCategory"("isActive");

CREATE INDEX IF NOT EXISTS "TaskCatalogueTask_categoryId_idx" ON "service_users"."TaskCatalogueTask"("categoryId");
CREATE INDEX IF NOT EXISTS "TaskCatalogueTask_deletedAt_idx" ON "service_users"."TaskCatalogueTask"("deletedAt");
CREATE INDEX IF NOT EXISTS "TaskCatalogueTask_isActive_idx" ON "service_users"."TaskCatalogueTask"("isActive");

CREATE UNIQUE INDEX IF NOT EXISTS "su_visit_task_assign_su_round_task_key"
    ON "service_users"."ServiceUserVisitTaskAssignment"("serviceUserId", "medicationRoundCode", "taskCatalogueTaskId");
CREATE INDEX IF NOT EXISTS "su_visit_task_assign_su_round_idx"
    ON "service_users"."ServiceUserVisitTaskAssignment"("serviceUserId", "medicationRoundCode");
CREATE INDEX IF NOT EXISTS "ServiceUserVisitTaskAssignment_deletedAt_idx" ON "service_users"."ServiceUserVisitTaskAssignment"("deletedAt");
CREATE INDEX IF NOT EXISTS "ServiceUserVisitTaskAssignment_isActive_idx" ON "service_users"."ServiceUserVisitTaskAssignment"("isActive");

CREATE UNIQUE INDEX IF NOT EXISTS "sched_visit_task_job_assignment_key"
    ON "scheduling"."ScheduledVisitTaskCompletion"("scheduledJobId", "assignmentId");
CREATE INDEX IF NOT EXISTS "ScheduledVisitTaskCompletion_scheduledJobId_idx" ON "scheduling"."ScheduledVisitTaskCompletion"("scheduledJobId");
CREATE INDEX IF NOT EXISTS "ScheduledVisitTaskCompletion_assignmentId_idx" ON "scheduling"."ScheduledVisitTaskCompletion"("assignmentId");

DO $$ BEGIN
  ALTER TABLE "service_users"."TaskCatalogueCategory"
    ADD CONSTRAINT "TaskCatalogueCategory_groupId_fkey"
    FOREIGN KEY ("groupId") REFERENCES "service_users"."TaskCatalogueGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "service_users"."TaskCatalogueTask"
    ADD CONSTRAINT "TaskCatalogueTask_categoryId_fkey"
    FOREIGN KEY ("categoryId") REFERENCES "service_users"."TaskCatalogueCategory"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "service_users"."ServiceUserVisitTaskAssignment"
    ADD CONSTRAINT "ServiceUserVisitTaskAssignment_serviceUserId_fkey"
    FOREIGN KEY ("serviceUserId") REFERENCES "service_users"."ServiceUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "service_users"."ServiceUserVisitTaskAssignment"
    ADD CONSTRAINT "ServiceUserVisitTaskAssignment_taskCatalogueTaskId_fkey"
    FOREIGN KEY ("taskCatalogueTaskId") REFERENCES "service_users"."TaskCatalogueTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "service_users"."ServiceUserVisitTaskAssignment"
    ADD CONSTRAINT "ServiceUserVisitTaskAssignment_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "identity"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "service_users"."ServiceUserVisitTaskAssignment"
    ADD CONSTRAINT "ServiceUserVisitTaskAssignment_updatedById_fkey"
    FOREIGN KEY ("updatedById") REFERENCES "identity"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "scheduling"."ScheduledVisitTaskCompletion"
    ADD CONSTRAINT "ScheduledVisitTaskCompletion_scheduledJobId_fkey"
    FOREIGN KEY ("scheduledJobId") REFERENCES "scheduling"."ScheduledJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "scheduling"."ScheduledVisitTaskCompletion"
    ADD CONSTRAINT "ScheduledVisitTaskCompletion_assignmentId_fkey"
    FOREIGN KEY ("assignmentId") REFERENCES "service_users"."ServiceUserVisitTaskAssignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "scheduling"."ScheduledVisitTaskCompletion"
    ADD CONSTRAINT "ScheduledVisitTaskCompletion_completedById_fkey"
    FOREIGN KEY ("completedById") REFERENCES "employees"."Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
