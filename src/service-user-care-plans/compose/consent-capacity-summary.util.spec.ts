import type { SubmissionAnswerForRules } from '../../initial-assessments/initial-assessment-care-plan-rules.util';
import { iaConsentCapacitySummary } from './consent-capacity-summary.util';

const a = (fieldKey: string, patch: Partial<SubmissionAnswerForRules>): SubmissionAnswerForRules =>
  ({
    fieldKey,
    specRef: '2.x',
    questionText: fieldKey,
    checked: null,
    booleanValue: null,
    textValue: null,
    selectedOptions: null,
    ...patch,
  }) as SubmissionAnswerForRules;

describe('iaConsentCapacitySummary', () => {
  it('summarises consent, capacity and legal authority in plain words', () => {
    const text = iaConsentCapacitySummary([
      a('consentToAssessment', { booleanValue: true }),
      a('consentMethod', { selectedOptions: ['verbal'] }),
      a('capacityDoubt', { booleanValue: true }),
      a('capacityDoubtReason', { textValue: '<p>Diagnosed dementia, confused today</p>' }),
      a('legalAuthority', { selectedOptions: ['hw_lpa'] }),
      a('legalAuthorityName', { textValue: 'Sarah Thompson' }),
      a('legalAuthorityRole', { textValue: 'Daughter' }),
    ]);
    expect(text).toBe(
      [
        'Consented to assessment (verbal)',
        'Reason to doubt capacity: Diagnosed dementia, confused today — MCA required',
        'Legal authority: Health & Welfare LPA — Sarah Thompson (Daughter)',
      ].join('\n'),
    );
  });

  it('reads older IAs (consent given by / capacity appears intact)', () => {
    const text = iaConsentCapacitySummary([
      a('consentGivenBy', { selectedOptions: ['service_user'] }),
      a('', {
        fieldKey: undefined,
        booleanValue: true,
        specRef: '2.4',
        questionText: 'Capacity to consent to assessment appears intact?',
      }),
    ]);
    expect(text).toBe('Capacity to consent appears intact\nConsent given by: service user');
  });

  it('returns null when nothing was answered', () => {
    expect(iaConsentCapacitySummary([])).toBeNull();
  });
});
