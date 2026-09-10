-- Employee + funder → pay card overrides (council-specific carer rates).
-- Existing EmployeeEmployment.defaultPayCardId remains the fallback.

CREATE TABLE "billing"."EmployeeFunderPayAssignment" (
    "id" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "funderId" UUID NOT NULL,
    "payCardId" UUID NOT NULL,
    "effectiveFrom" DATE NOT NULL,
    "effectiveTo" DATE,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdById" UUID,
    "updatedById" UUID,

    CONSTRAINT "EmployeeFunderPayAssignment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "EmployeeFunderPayAssignment_employeeId_idx"
  ON "billing"."EmployeeFunderPayAssignment"("employeeId");

CREATE INDEX "EmployeeFunderPayAssignment_funderId_idx"
  ON "billing"."EmployeeFunderPayAssignment"("funderId");

CREATE INDEX "EmployeeFunderPayAssignment_payCardId_idx"
  ON "billing"."EmployeeFunderPayAssignment"("payCardId");

CREATE INDEX "EmployeeFunderPayAssignment_deletedAt_idx"
  ON "billing"."EmployeeFunderPayAssignment"("deletedAt");

CREATE INDEX "EmployeeFunderPayAssignment_employeeId_funderId_idx"
  ON "billing"."EmployeeFunderPayAssignment"("employeeId", "funderId");

-- One active assignment per employee+funder (soft-deleted rows excluded).
CREATE UNIQUE INDEX "EmployeeFunderPayAssignment_employee_funder_active_uidx"
  ON "billing"."EmployeeFunderPayAssignment"("employeeId", "funderId")
  WHERE "deletedAt" IS NULL;

ALTER TABLE "billing"."EmployeeFunderPayAssignment"
  ADD CONSTRAINT "EmployeeFunderPayAssignment_payCardId_fkey"
  FOREIGN KEY ("payCardId") REFERENCES "billing"."PayCard"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
