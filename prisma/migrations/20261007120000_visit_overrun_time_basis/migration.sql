-- CreateEnum
CREATE TYPE "billing"."VisitOverrunTimeBasis" AS ENUM ('PLANNED', 'ACTUAL');

-- AlterTable
ALTER TABLE "billing"."VisitReconciliation" ADD COLUMN     "overrunBillBasis" "billing"."VisitOverrunTimeBasis",
ADD COLUMN     "overrunPayBasis" "billing"."VisitOverrunTimeBasis";

