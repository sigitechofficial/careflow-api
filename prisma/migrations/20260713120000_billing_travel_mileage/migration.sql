-- Travel distance / time on visit reconciliations + payroll line types

ALTER TYPE "billing"."PayrollRunLineType" ADD VALUE IF NOT EXISTS 'MILEAGE';
ALTER TYPE "billing"."PayrollRunLineType" ADD VALUE IF NOT EXISTS 'TRAVEL_TIME';

ALTER TABLE "billing"."VisitReconciliation"
  ADD COLUMN IF NOT EXISTS "travelMiles" DECIMAL(10,2),
  ADD COLUMN IF NOT EXISTS "travelMinutes" INTEGER;
