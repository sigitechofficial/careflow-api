-- CreateEnum
CREATE TYPE "surveys"."SurveyRespondentRelation" AS ENUM ('SELF', 'FAMILY_MEMBER', 'REPRESENTATIVE');

-- AlterTable
ALTER TABLE "surveys"."SurveyResponse" ADD COLUMN     "respondentName" TEXT,
ADD COLUMN     "respondentRelation" "surveys"."SurveyRespondentRelation";
