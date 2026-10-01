import {
  carerLpaCard,
  carerLpaCardFromRegister,
  mapCapacityDecision,
} from './employee-app-client-detail.service';
import { carerAuthorityCards } from '../service-user-documents/legal-authority-coverage.util';
import { capacityDecisionForCarers } from '../initial-assessments/initial-assessment-capacity-decisions.util';

const latest = {
  completedAt: new Date('2026-09-01T10:00:00Z'),
  completedBy: null,
};

describe('mapCapacityDecision', () => {
  it('never defaults a decision without an outcome to "lacks capacity"', () => {
    expect(
      mapCapacityDecision({ title: 'Consent to care' }, 0, latest),
    ).toBeNull();
  });

  it('maps stated outcomes for a named decision', () => {
    expect(
      mapCapacityDecision(
        { title: 'Covert medication', hasCapacity: false },
        0,
        latest,
      ),
    ).toMatchObject({
      status: 'lacks_capacity',
      title: 'Covert medication',
    });
    expect(
      mapCapacityDecision(
        { title: 'Photography', status: 'has_capacity' },
        1,
        latest,
      ),
    ).toMatchObject({
      status: 'has_capacity',
    });
  });

  it('reads a decision record promoted from the IA (who decides, wishes, objection)', () => {
    const promoted = capacityDecisionForCarers({
      id: 'd1',
      decision: 'care_arrangements',
      outcome: 'lacks_capacity',
      authorityCovers: 'no',
      bestInterestsOutcome: 'Door alarm at night only',
      wishes: 'Wants to walk in the garden',
      objection: 'yes',
      reviewDate: '2026-12-01',
    });
    expect(mapCapacityDecision(promoted, 0, latest)).toMatchObject({
      id: 'd1',
      title: 'Care arrangements that restrict freedom (deprivation of liberty)',
      status: 'lacks_capacity',
      reviewAt: '2026-12-01',
      note: 'Best-interests decision: Door alarm at night only Their wishes: Wants to walk in the garden They object — see office.',
    });
  });
});

describe('carerLpaCard', () => {
  const legal = (
    over: Partial<Parameters<typeof carerLpaCard>[0] & object>,
  ) => ({
    lpaStatusConfirmation: 'UNKNOWN',
    lpaHealthCertificateUrl: null,
    lpaFinanceCertificateUrl: null,
    ...over,
  });

  it('shows no card when nothing is recorded', () => {
    expect(carerLpaCard(null)).toBeNull();
    expect(carerLpaCard(legal({}))).toBeNull();
  });

  it('never presents a finance LPA as care authority or sends its certificate', () => {
    const card = carerLpaCard(
      legal({
        lpaFinanceCertificateUrl: '/f.pdf',
        lpaStatusConfirmation: 'IN_FORCE',
      }),
    )!;
    expect(card.typeLabel).toBe('Property & financial affairs LPA');
    expect(card.scopeNote).toContain('NOT give anyone authority over care');
    expect(card.financeCertificateUrl).toBeNull();
  });

  it('labels a health & welfare LPA with its scope', () => {
    const card = carerLpaCard(
      legal({
        lpaHealthCertificateUrl: '/h.pdf',
        lpaStatusConfirmation: 'IN_FORCE',
      }),
    )!;
    expect(card.typeLabel).toBe('Health & welfare LPA');
    expect(card.scopeNote).toContain('lacks capacity');
  });
});

describe('carerLpaCardFromRegister', () => {
  const today = '2026-09-29';
  it('prefers a care authority and never shows an unchecked one', () => {
    const rows = [
      {
        id: 'pf',
        category: 'LPA_PROPERTY_FINANCE' as const,
        holderName: 'Sam',
        holderRelationship: 'Son',
        verificationStatus: 'VERIFIED' as const,
      },
      {
        id: 'hw',
        category: 'LPA_HEALTH_WELFARE' as const,
        holderName: 'Ann',
        holderRelationship: 'Daughter',
        verificationStatus: 'DOCUMENT_SEEN' as const,
      },
      {
        id: 'rep',
        category: 'DEPUTY_HEALTH_WELFARE' as const,
        holderName: 'X',
        holderRelationship: '',
        verificationStatus: 'REPORTED' as const,
      },
    ];
    const card = carerLpaCardFromRegister(
      carerAuthorityCards(rows, today),
      rows,
    );
    expect(card).toMatchObject({
      attorneyName: 'Ann',
      attorneyRelationship: 'Daughter',
      typeLabel: 'Health & welfare LPA',
    });
    expect(
      carerLpaCardFromRegister(carerAuthorityCards([rows[2]!], today), rows),
    ).toBeNull();
  });
});
