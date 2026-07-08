-- Link pay cards to individual carers and employee default pay cards
ALTER TABLE "billing"."PayCard"
  ADD COLUMN "assignmentTargetId" UUID;

ALTER TABLE "employees"."EmployeeEmployment"
  ADD COLUMN "defaultPayCardId" UUID;

CREATE INDEX "PayCard_assignmentTargetId_idx" ON "billing"."PayCard"("assignmentTargetId");
CREATE INDEX "EmployeeEmployment_defaultPayCardId_idx" ON "employees"."EmployeeEmployment"("defaultPayCardId");

ALTER TABLE "billing"."PayCard"
  ADD CONSTRAINT "PayCard_assignmentTargetId_fkey"
  FOREIGN KEY ("assignmentTargetId") REFERENCES "employees"."Employee"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "employees"."EmployeeEmployment"
  ADD CONSTRAINT "EmployeeEmployment_defaultPayCardId_fkey"
  FOREIGN KEY ("defaultPayCardId") REFERENCES "billing"."PayCard"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
