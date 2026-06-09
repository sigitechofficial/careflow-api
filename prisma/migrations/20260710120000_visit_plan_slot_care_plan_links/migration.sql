-- Link visit plan call slots to accepted clinical care plan forms.
ALTER TABLE "service_users"."VisitPlanSlot"
ADD COLUMN "linkedCarePlanFormIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
