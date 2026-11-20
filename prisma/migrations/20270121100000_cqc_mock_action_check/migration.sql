-- Mock CQC inspection: the check of a statement an improvement action came from. Additive only.

-- AlterTable
ALTER TABLE "quality"."CqcMockInspectionAction" ADD COLUMN     "checkText" TEXT;
