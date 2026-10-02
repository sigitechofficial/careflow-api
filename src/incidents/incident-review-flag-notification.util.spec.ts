import { buildIncidentReviewFlagNotification } from './incident-review-flag-notification.util';

const base = {
  referenceNumber: 'INC-2026-0042',
  categoryLabel: 'Fall',
  severity: 'HIGH',
  occurredAtLabel: '28/09/2026 at 14:00',
  personShortName: 'Harry',
  personFullName: 'Harry Max',
  reviewerName: 'Sarah Khan',
};

describe('buildIncidentReviewFlagNotification', () => {
  it('names the person and notes when escalation is also required', () => {
    expect(
      buildIncidentReviewFlagNotification({
        ...base,
        safeguardingConcern: true,
        escalationRequired: true,
      }),
    ).toEqual({
      title: 'Safeguarding concern — Harry',
      message:
        'INC-2026-0042 · Fall (High) on 28/09/2026 at 14:00 — Harry Max. Flagged during review by Sarah Khan. Escalation also required.',
    });
  });

  it('uses the escalation title when only escalation is flagged', () => {
    const out = buildIncidentReviewFlagNotification({
      ...base,
      safeguardingConcern: false,
      escalationRequired: true,
    });
    expect(out.title).toBe('Escalation required — Harry');
    expect(out.message).not.toContain('also required');
  });

  it('falls back to the reference number when no person is linked', () => {
    expect(
      buildIncidentReviewFlagNotification({
        referenceNumber: 'INC-2026-0042',
        safeguardingConcern: true,
        escalationRequired: false,
      }),
    ).toEqual({
      title: 'Safeguarding concern — INC-2026-0042',
      message: 'INC-2026-0042 · Incident. Flagged during review.',
    });
  });
});
