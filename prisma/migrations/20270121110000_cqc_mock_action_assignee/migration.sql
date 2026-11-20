-- Mock CQC inspection: the staff member (employee) an improvement action is for. Additive only.

-- AlterTable
ALTER TABLE "quality"."CqcMockInspectionAction" ADD COLUMN     "assignedEmployeeId" UUID;
