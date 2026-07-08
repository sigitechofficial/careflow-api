-- Move to reusable pay card templates (Birdie / Access model).
-- Carers are assigned via EmployeeEmployment.defaultPayCardId, not on the card itself.

UPDATE "billing"."PayCard"
SET "assignmentLevel" = 'ORGANISATION_DEFAULT'
WHERE "assignmentLevel" = 'CARER';

ALTER TABLE "billing"."PayCard" DROP CONSTRAINT IF EXISTS "PayCard_assignmentTargetId_fkey";
DROP INDEX IF EXISTS "billing"."PayCard_assignmentTargetId_idx";
ALTER TABLE "billing"."PayCard" DROP COLUMN IF EXISTS "assignmentTargetId";

ALTER TYPE "billing"."PayCardAssignmentLevel" RENAME TO "PayCardAssignmentLevel_old";

CREATE TYPE "billing"."PayCardAssignmentLevel" AS ENUM (
  'ROLE',
  'BRANCH',
  'EMPLOYMENT_TYPE',
  'WORKER_TYPE',
  'ORGANISATION_DEFAULT'
);

ALTER TABLE "billing"."PayCard"
  ALTER COLUMN "assignmentLevel" DROP DEFAULT;

ALTER TABLE "billing"."PayCard"
  ALTER COLUMN "assignmentLevel" TYPE "billing"."PayCardAssignmentLevel"
  USING ("assignmentLevel"::text::"billing"."PayCardAssignmentLevel");

ALTER TABLE "billing"."PayCard"
  ALTER COLUMN "assignmentLevel" SET DEFAULT 'ORGANISATION_DEFAULT';

DROP TYPE "billing"."PayCardAssignmentLevel_old";
