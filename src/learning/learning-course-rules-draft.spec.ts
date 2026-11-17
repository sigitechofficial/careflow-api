import {
  completionRulesError,
  draftRulesFromUpdate,
} from './learning-courses.service';

describe('draft completion rules', () => {
  it('copies only the rule fields that were sent', () => {
    expect(
      draftRulesFromUpdate({
        requiresAssessment: true,
        cpdMinutes: null,
        certificateEnabled: undefined,
      }),
    ).toEqual({ requiresAssessment: true, cpdMinutes: null });
  });

  it('needs a certificate for a refresher', () => {
    expect(
      completionRulesError({
        certificateEnabled: false,
        refresherFrequencyDays: 365,
      }),
    ).toMatch(/certificate/);
    expect(
      completionRulesError({
        certificateEnabled: true,
        refresherFrequencyDays: 365,
      }),
    ).toBeNull();
    expect(
      completionRulesError({
        certificateEnabled: false,
        refresherFrequencyDays: null,
      }),
    ).toBeNull();
  });
});
