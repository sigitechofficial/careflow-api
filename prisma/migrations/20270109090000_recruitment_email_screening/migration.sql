-- Free rules screening before Claude reads a recruitment email.
ALTER TABLE "employees"."RecruitmentEmail" ADD COLUMN "screening" JSONB;
