-- Role that gets Learning tasks in My tasks (18 Nov 2026). Null = the Admin role.
ALTER TABLE "learning"."LearningSettings" ADD COLUMN IF NOT EXISTS "taskRoleId" UUID;
