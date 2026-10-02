import {
  authorityCoverage,
  carerAuthorityCards,
  categoryFromConsentAnswer,
  categoryGivesCareAuthority,
  type LegalAuthorityRow,
} from './legal-authority-coverage.util';

const TODAY = '2026-09-29';
const row = (patch: Partial<LegalAuthorityRow>): LegalAuthorityRow => ({
  id: 'a1',
  category: 'LPA_HEALTH_WELFARE',
  holderName: 'Jane Smith',
  verificationStatus: 'VERIFIED',
  ...patch,
});

describe('authorityCoverage', () => {
  it('a verified health & welfare LPA covers care decisions (only where capacity is lacking)', () => {
    const c = authorityCoverage([row({})], 'consent_to_care', TODAY);
    expect(c.status).toBe('covered');
    expect(c.note).toMatch(/lacks capacity/);
  });

  it('finance authorities never cover care; next of kin is not an authority at all', () => {
    for (const category of ['LPA_PROPERTY_FINANCE', 'EPA', 'DEPUTY_PROPERTY_AFFAIRS', 'APPOINTEE'] as const) {
      expect(categoryGivesCareAuthority(category)).toBe(false);
      expect(authorityCoverage([row({ category })], 'medication_support', TODAY).status).toBe('none');
      expect(authorityCoverage([row({ category })], 'finance_support', TODAY).status).toBe('covered');
    }
  });

  it('only a court order can cover a deprivation of liberty', () => {
    expect(authorityCoverage([row({})], 'care_arrangements', TODAY)).toMatchObject({
      status: 'none',
      note: expect.stringMatching(/Court of Protection/),
    });
    const court = authorityCoverage([row({ category: 'COURT_ORDER' })], 'care_arrangements', TODAY);
    expect(court.status).toBe('covered');
    expect(court.note).toMatch(/Check the order covers this decision/);
  });

  it('a reported (not seen) authority cannot be relied on', () => {
    expect(authorityCoverage([row({ verificationStatus: 'REPORTED' })], 'consent_to_care', TODAY).status).toBe(
      'unverified',
    );
  });

  it('revoked, expired or inactive authorities do not count', () => {
    expect(authorityCoverage([row({ verificationStatus: 'NOT_VALID' })], 'consent_to_care', TODAY).status).toBe('none');
    expect(authorityCoverage([row({ expiresOn: '2026-01-01' })], 'consent_to_care', TODAY).status).toBe('none');
    expect(authorityCoverage([row({ isActive: false })], 'consent_to_care', TODAY).status).toBe('none');
  });
});

describe('carerAuthorityCards', () => {
  it('shows only evidenced authorities and says finance ones do not cover care', () => {
    const cards = carerAuthorityCards(
      [
        row({ id: 'hw' }),
        row({ id: 'pf', category: 'LPA_PROPERTY_FINANCE' }),
        row({ id: 'rep', verificationStatus: 'REPORTED' }),
      ],
      TODAY,
    );
    expect(cards.map((c) => c.id)).toEqual(['hw', 'pf']);
    expect(cards[1]).toMatchObject({ coversCare: false, scopeNote: expect.stringMatching(/does NOT give/) });
  });
});

describe('categoryFromConsentAnswer', () => {
  it('maps consent-tab answers and ignores none / unsure', () => {
    expect(categoryFromConsentAnswer('hw_lpa')).toBe('LPA_HEALTH_WELFARE');
    expect(categoryFromConsentAnswer('deputy')).toBe('DEPUTY_HEALTH_WELFARE');
    expect(categoryFromConsentAnswer('unsure')).toBeNull();
  });
});
