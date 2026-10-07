-- Office users are kept separate from employees: drop the optional employee link.
-- DropIndex
DROP INDEX IF EXISTS "identity"."User_employeeId_key";

-- AlterTable
ALTER TABLE "identity"."User" DROP COLUMN IF EXISTS "employeeId";

