/** Mirrors care-admin AddBodyMapRecordWizard steps and pick-list options. */
export const EMPLOYEE_APP_BODY_MAP_WIZARD_STEPS = {
  default: ['Type', 'Location', 'Observation', 'Cause', 'Action'] as const,
  medication: ['Type', 'Location', 'MAR link', 'Observation', 'Cause', 'Action'] as const,
};

export function employeeAppBodyMapWizardCatalog() {
  return {
    steps: EMPLOYEE_APP_BODY_MAP_WIZARD_STEPS,
    fields: {
      purposes: ['New observation', 'Review existing concern', 'Medication site'],
      noticedDuring: ['Visit', 'Personal care', 'Medication round', 'Incident', 'Review'],
      sides: [
        { label: 'Left', value: 'Left' },
        { label: 'Right', value: 'Right' },
        { label: 'Centre', value: 'Centre' },
      ],
      riskLevels: ['LOW', 'MEDIUM', 'HIGH', 'URGENT'],
      skinIntact: ['Intact', 'Broken'],
      causeKnown: ['yes', 'no'],
      consistentWithInjury: ['yes', 'no', 'unknown'],
      managerInformed: ['Yes', 'No', 'N/A'],
      reviewRequired: ['yes', 'no'],
      woundTypes: ['Skin tear', 'Open wound', 'Surgical wound', 'Pressure related', 'Moisture lesion'],
      exudateLevels: ['None', 'Low', 'Moderate', 'High'],
      pressureRiskTools: ['Waterlow', 'Braden', 'Local tool'],
      blanchingOptions: ['Blanching', 'Non-blanching', 'Not assessed'],
      repositioningRecorded: ['Yes', 'No'],
    },
    validation: {
      type: { required: ['subType', 'firstNoticedAt'] },
      location: { required: ['marker', 'bodyPart'], bodyPartMustBeClinical: true },
      marLink: { requiredWhenRecordType: 'MEDICATION', required: ['medicationSite.serviceUserMedicationId'] },
      observation: { required: ['description'] },
      cause: { required: [] },
      action: { required: ['actionSummary'] },
    },
  };
}
