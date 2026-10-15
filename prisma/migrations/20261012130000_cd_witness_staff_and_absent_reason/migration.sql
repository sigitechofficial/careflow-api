-- AlterTable: link a co-carer witness to the staff record, and record why no witness was present
ALTER TABLE "service_users"."MedicationAdministrationEvent" ADD COLUMN     "witnessEmployeeId" UUID,
ADD COLUMN     "witnessAbsentReasonCode" VARCHAR(32);

-- AddForeignKey
ALTER TABLE "service_users"."MedicationAdministrationEvent" ADD CONSTRAINT "MedicationAdministrationEvent_witnessEmployeeId_fkey" FOREIGN KEY ("witnessEmployeeId") REFERENCES "employees"."Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;
