-- Gate C7: company directors' National Insurance (standard annual earnings period, method AN).
-- Additive: four nullable columns. No existing row is changed: isDirector stays null (not yet
-- classified) until a person confirms it, and tax and NI are not calculated until then.
-- Rollback: drop the four columns.

-- AlterTable
ALTER TABLE "payroll"."EmployeePayrollProfile" ADD COLUMN     "isDirector" BOOLEAN,
ADD COLUMN     "directorAppointedOn" DATE,
ADD COLUMN     "directorNicMethod" TEXT;

-- AlterTable
ALTER TABLE "payroll"."UkPayrollRunEmployee" ADD COLUMN     "directorNicMethodApplied" TEXT;
