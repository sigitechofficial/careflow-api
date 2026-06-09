ALTER TABLE "service_users"."VisitPlanSlot"
ADD COLUMN "assignedEmployeeIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
