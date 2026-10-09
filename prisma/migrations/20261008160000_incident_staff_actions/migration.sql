-- Outcome & close → Staff actions: what was decided for each staff member (warning, fine, …).
CREATE TABLE "incidents"."IncidentStaffAction" (
    "id" UUID NOT NULL,
    "incidentId" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "actionType" VARCHAR(40) NOT NULL,
    "reason" TEXT NOT NULL,
    "staffInformedOn" DATE,
    "fineAmount" DECIMAL(12,2),
    "fineSalaryMonth" VARCHAR(7),
    "deductionAllowedConfirmed" BOOLEAN NOT NULL DEFAULT false,
    "salaryDeductionId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" UUID,
    "updatedById" UUID,
    "deletedAt" TIMESTAMP(3),
    "deletedById" UUID,
    "deleteReason" TEXT,

    CONSTRAINT "IncidentStaffAction_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "IncidentStaffAction_incidentId_idx" ON "incidents"."IncidentStaffAction"("incidentId");
CREATE INDEX "IncidentStaffAction_employeeId_idx" ON "incidents"."IncidentStaffAction"("employeeId");
CREATE INDEX "IncidentStaffAction_deletedAt_idx" ON "incidents"."IncidentStaffAction"("deletedAt");

ALTER TABLE "incidents"."IncidentStaffAction" ADD CONSTRAINT "IncidentStaffAction_incidentId_fkey"
    FOREIGN KEY ("incidentId") REFERENCES "incidents"."Incident"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- A fine decided on an incident is linked back to it.
ALTER TABLE "billing"."EmployeeSalaryDeduction" ADD COLUMN "incidentId" UUID;
ALTER TABLE "billing"."EmployeeSalaryDeduction" ADD COLUMN "incidentStaffActionId" UUID;
CREATE INDEX "EmployeeSalaryDeduction_incidentStaffActionId_idx" ON "billing"."EmployeeSalaryDeduction"("incidentStaffActionId");
