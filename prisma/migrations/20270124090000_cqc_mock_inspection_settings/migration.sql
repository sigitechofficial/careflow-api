-- Mock CQC inspection settings: points for each check answer and the % a statement needs for each score.
-- AlterTable
ALTER TABLE "quality"."CqcMockInspection" ADD COLUMN     "checkScoring" JSONB;

-- CreateTable
CREATE TABLE "quality"."CqcMockInspectionSettings" (
    "id" UUID NOT NULL,
    "metPoints" INTEGER NOT NULL DEFAULT 2,
    "partlyMetPoints" INTEGER NOT NULL DEFAULT 1,
    "notMetPoints" INTEGER NOT NULL DEFAULT 0,
    "score4Percent" INTEGER NOT NULL DEFAULT 100,
    "score3Percent" INTEGER NOT NULL DEFAULT 75,
    "score2Percent" INTEGER NOT NULL DEFAULT 50,
    "updatedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CqcMockInspectionSettings_pkey" PRIMARY KEY ("id")
);
