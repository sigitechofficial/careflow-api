-- Vacancy: what the salary is per (careers page shows "per month" etc.) and the last day to apply.
CREATE TYPE "employees"."SalaryPeriod" AS ENUM ('HOUR', 'DAY', 'WEEK', 'MONTH', 'YEAR');

ALTER TABLE "employees"."Vacancy" ADD COLUMN "salaryPeriod" "employees"."SalaryPeriod",
ADD COLUMN "closingDate" DATE;
