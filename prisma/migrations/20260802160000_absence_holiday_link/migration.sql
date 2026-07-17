-- AlterTable
ALTER TABLE "employees"."EmployeeAbsenceRecord" ADD COLUMN "holidayId" UUID;

-- CreateIndex
CREATE UNIQUE INDEX "EmployeeAbsenceRecord_holidayId_key"
  ON "employees"."EmployeeAbsenceRecord"("holidayId");

-- AddForeignKey
ALTER TABLE "employees"."EmployeeAbsenceRecord"
  ADD CONSTRAINT "EmployeeAbsenceRecord_holidayId_fkey"
  FOREIGN KEY ("holidayId") REFERENCES "employees"."EmployeeHoliday"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
