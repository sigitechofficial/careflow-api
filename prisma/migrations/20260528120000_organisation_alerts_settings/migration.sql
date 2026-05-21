ALTER TABLE "identity"."OrganisationGeneralSettings"
  ADD COLUMN "alertActionsOverdueEnabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "alertActionsOverdueMinutes" INTEGER NOT NULL DEFAULT 30,
  ADD COLUMN "alertRequiredCheckNotTicked" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "alertRequiredMedicationNotGiven" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "alertScheduleJobsBeforeHours" INTEGER NOT NULL DEFAULT 24,
  ADD COLUMN "alertBeepOnNewAlert" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "alertFluidAlertsEnabled" BOOLEAN NOT NULL DEFAULT false;
