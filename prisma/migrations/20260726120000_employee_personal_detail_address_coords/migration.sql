-- AlterTable
ALTER TABLE "employees"."EmployeePersonalDetail"
ADD COLUMN "county" TEXT,
ADD COLUMN "latitude" DECIMAL(10,7),
ADD COLUMN "longitude" DECIMAL(10,7);
