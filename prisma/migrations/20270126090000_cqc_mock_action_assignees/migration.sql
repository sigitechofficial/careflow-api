-- Mock CQC inspection: an improvement action can be for several staff members (employees), not one.
-- The one already chosen on each action is kept as the first in the list.

-- AlterTable
ALTER TABLE "quality"."CqcMockInspectionAction" ADD COLUMN     "assignedEmployeeIds" UUID[] DEFAULT ARRAY[]::UUID[];

UPDATE "quality"."CqcMockInspectionAction"
SET "assignedEmployeeIds" = ARRAY["assignedEmployeeId"]
WHERE "assignedEmployeeId" IS NOT NULL;

ALTER TABLE "quality"."CqcMockInspectionAction" DROP COLUMN "assignedEmployeeId";
