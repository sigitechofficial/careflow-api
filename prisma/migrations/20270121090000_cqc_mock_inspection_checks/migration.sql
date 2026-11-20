-- Mock CQC inspection: answers to each statement's checks (MET / PARTIALLY_MET / NOT_MET). Additive only.

-- AlterTable
ALTER TABLE "quality"."CqcMockInspectionStatement" ADD COLUMN     "checks" JSONB;
