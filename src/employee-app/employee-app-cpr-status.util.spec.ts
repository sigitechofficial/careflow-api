import { cprReportFromIa, resolveCprStatus, type CprLegalRecord } from './employee-app-cpr-status.util';

const office = (
  dnacprStatusConfirmation: CprLegalRecord['dnacprStatusConfirmation'],
  dnacprInPlace: boolean,
  dnacprPhysicalLocation: string | null = null,
): CprLegalRecord => ({ dnacprStatusConfirmation, dnacprInPlace, dnacprPhysicalLocation });

describe('resolveCprStatus', () => {
  it('never defaults an unknown status to For CPR', () => {
    const status = resolveCprStatus(null, null);
    expect(status.id).toBe('cpr_status_not_recorded');
    expect(status.label).not.toMatch(/for cpr/i);
    expect(status.label).toMatch(/dnacpr/i);
    expect(status.tone).toBe('warning');
  });

  it('shows a verified DNACPR only when the office confirmed it in place', () => {
    const status = resolveCprStatus(office('IN_PLACE', true, 'Red folder'), null);
    expect(status).toMatchObject({ id: 'dnacpr_verified', verified: true, location: 'Red folder' });
  });

  it('shows office-confirmed none without a For CPR instruction', () => {
    const status = resolveCprStatus(office('NOT_IN_PLACE', false), null);
    expect(status.id).toBe('no_dnacpr_confirmed');
    expect(status.label).toMatch(/dnacpr/i);
    expect(status.verified).toBe(false);
  });

  it('treats an IA-only report as unverified, never as an instruction', () => {
    const status = resolveCprStatus(null, { reportsInPlace: true, pendingReview: true });
    expect(status.id).toBe('dnacpr_reported_unverified');
    expect(status.verified).toBe(false);
    expect(status.actionLine).toContain('pending manager review');
    expect(status.actionLine).toContain('contact the office');
  });

  it('treats an office record without confirmation as unverified', () => {
    const status = resolveCprStatus(office('UNKNOWN', true, 'Hall table'), null);
    expect(status).toMatchObject({ id: 'dnacpr_reported_unverified', location: 'Hall table' });
  });

  it('flags a conflict between the office record and the IA', () => {
    expect(resolveCprStatus(office('NOT_IN_PLACE', false), { reportsInPlace: true, pendingReview: false }).id).toBe(
      'dnacpr_status_conflict',
    );
    expect(resolveCprStatus(office('IN_PLACE', true), { reportsInPlace: false, pendingReview: false }).id).toBe(
      'dnacpr_status_conflict',
    );
    expect(resolveCprStatus(office('IN_PLACE', false), null).id).toBe('dnacpr_status_conflict');
  });

  it('does not treat an IA "No" as confirmation of no DNACPR', () => {
    expect(resolveCprStatus(null, { reportsInPlace: false, pendingReview: false }).id).toBe(
      'cpr_status_not_recorded',
    );
  });
});

describe('cprReportFromIa', () => {
  const q = (questionText: string, metadata: unknown = {}) => ({ questionText, metadata });

  it('reads §13.6 by fieldKey or text', () => {
    expect(
      cprReportFromIa([{ checked: null, booleanValue: true, question: q('x', { fieldKey: 'dnacprRespectInPlace' }) }], {}),
    ).toBe(true);
    expect(
      cprReportFromIa([{ checked: false, booleanValue: null, question: q('DNACPR or ReSPECT in place?') }], {}),
    ).toBe(false);
  });

  it('falls back to the End of Life DNR answer', () => {
    expect(cprReportFromIa([], { endOfLifeAssessment: { dnrInPlaceAnswer: true } })).toBe(true);
    expect(cprReportFromIa([], {})).toBeNull();
  });
});
