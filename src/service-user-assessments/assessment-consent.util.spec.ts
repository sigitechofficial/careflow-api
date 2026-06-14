import {
  extractAssessmentConsentFromSnapshot,
  validateAssessmentConsentForCompletion,
} from './assessment-consent.util';

describe('assessment-consent.util', () => {
  it('requires consent on manual completions', () => {
    expect(validateAssessmentConsentForCompletion({}, 'waterlow', 'MANUAL')).toMatch(/consent must be recorded/i);
  });

  it('accepts declined consent with reason', () => {
    const snapshot = {
      assessmentConsent: {
        consentObtained: false,
        declinedReason: 'Service user refused today.',
      },
    };
    expect(validateAssessmentConsentForCompletion(snapshot, 'must', 'MANUAL')).toBeNull();
  });

  it('exempts photography consent assessment', () => {
    expect(validateAssessmentConsentForCompletion({}, 'photography-consent', 'MANUAL')).toBeNull();
  });

  it('extracts consent from snapshot', () => {
    const snapshot = {
      assessmentConsent: {
        consentObtained: true,
        givenBy: 'service_user',
        method: 'verbal',
        consentDate: '2026-06-01',
        capacityIntact: true,
      },
    };
    expect(extractAssessmentConsentFromSnapshot(snapshot)?.givenBy).toBe('service_user');
  });
});
