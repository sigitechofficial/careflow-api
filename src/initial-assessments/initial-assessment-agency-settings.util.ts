export type InitialAssessmentAgencySettings = {
  blockWithoutEmergencyContact: boolean;
  blockWithoutNoResponseProcedure: boolean;
  managerReviewWaterlowThreshold: number;
  notifyManagersOnHighRiskSubmit: boolean;
  requireAssessorSignOff: boolean;
  requireNextReviewDate: boolean;
};

export const DEFAULT_INITIAL_ASSESSMENT_AGENCY_SETTINGS: InitialAssessmentAgencySettings = {
  blockWithoutEmergencyContact: true,
  blockWithoutNoResponseProcedure: true,
  managerReviewWaterlowThreshold: 15,
  notifyManagersOnHighRiskSubmit: true,
  requireAssessorSignOff: true,
  requireNextReviewDate: true,
};

export function getInitialAssessmentAgencySettings(): InitialAssessmentAgencySettings {
  return { ...DEFAULT_INITIAL_ASSESSMENT_AGENCY_SETTINGS };
}
