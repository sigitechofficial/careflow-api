-- WM-07 / EL-01: guaranteed hours.
-- Additive only: one new pay line type and four nullable columns. No existing row is changed, and
-- no employee is given a guarantee: a top-up is paid only under an agreement that states one and
-- that a second person approved.
-- Rollback: drop the four columns. The enum value cannot be removed while a pay line uses it.

-- AlterEnum
ALTER TYPE "billing"."PayrollRunLineType" ADD VALUE IF NOT EXISTS 'GUARANTEED_HOURS';

-- AlterTable
ALTER TABLE "payroll"."EmployeePayAgreement" ADD COLUMN     "guaranteeLeaveTreatment" TEXT,
ADD COLUMN     "guaranteeQualifyingTime" TEXT,
ADD COLUMN     "guaranteeTopUp" TEXT,
ADD COLUMN     "guaranteedWeeklyHours" DECIMAL(6,2);
