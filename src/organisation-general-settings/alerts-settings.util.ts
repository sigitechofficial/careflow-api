export type OrganisationAlertsSettings = {
  actionsOverdueEnabled: boolean;
  actionsOverdueMinutes: number;
  requiredCheckNotTicked: boolean;
  requiredMedicationNotGiven: boolean;
  scheduleJobsBeforeHours: number;
  beepOnNewAlert: boolean;
  fluidAlertsEnabled: boolean;
};

export const DEFAULT_ALERTS_SETTINGS: OrganisationAlertsSettings = {
  actionsOverdueEnabled: true,
  actionsOverdueMinutes: 30,
  requiredCheckNotTicked: true,
  requiredMedicationNotGiven: true,
  scheduleJobsBeforeHours: 24,
  beepOnNewAlert: true,
  fluidAlertsEnabled: false,
};

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value)));
}

export function parseOrganisationAlertsSettings(
  row: Partial<{
    alertActionsOverdueEnabled: boolean;
    alertActionsOverdueMinutes: number;
    alertRequiredCheckNotTicked: boolean;
    alertRequiredMedicationNotGiven: boolean;
    alertScheduleJobsBeforeHours: number;
    alertBeepOnNewAlert: boolean;
    alertFluidAlertsEnabled: boolean;
  }>,
): OrganisationAlertsSettings {
  return {
    actionsOverdueEnabled:
      row.alertActionsOverdueEnabled ?? DEFAULT_ALERTS_SETTINGS.actionsOverdueEnabled,
    actionsOverdueMinutes: clampInt(
      row.alertActionsOverdueMinutes ?? DEFAULT_ALERTS_SETTINGS.actionsOverdueMinutes,
      1,
      1440,
    ),
    requiredCheckNotTicked:
      row.alertRequiredCheckNotTicked ?? DEFAULT_ALERTS_SETTINGS.requiredCheckNotTicked,
    requiredMedicationNotGiven:
      row.alertRequiredMedicationNotGiven ??
      DEFAULT_ALERTS_SETTINGS.requiredMedicationNotGiven,
    scheduleJobsBeforeHours: clampInt(
      row.alertScheduleJobsBeforeHours ?? DEFAULT_ALERTS_SETTINGS.scheduleJobsBeforeHours,
      1,
      168,
    ),
    beepOnNewAlert: row.alertBeepOnNewAlert ?? DEFAULT_ALERTS_SETTINGS.beepOnNewAlert,
    fluidAlertsEnabled:
      row.alertFluidAlertsEnabled ?? DEFAULT_ALERTS_SETTINGS.fluidAlertsEnabled,
  };
}
