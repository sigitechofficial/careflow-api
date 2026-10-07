import {
  describeEvidenceChanges,
  describeSetupChanges,
  formatDayKey,
  missingSetupForCompletion,
} from './incident-investigation.util';

const names = { u1: 'Asha Patel', u2: 'Tom Reed' };

describe('describeSetupChanges', () => {
  it('adds nothing when the set-up is unchanged', () => {
    const s = { investigationLevel: 'STANDARD', leadInvestigatorEmployeeId: 'u1', targetDate: '2026-10-20' };
    expect(describeSetupChanges(s, { ...s }, names)).toEqual([]);
  });

  it('describes first values and later changes with the old value', () => {
    expect(
      describeSetupChanges(
        null,
        { investigationLevel: 'ENHANCED', leadInvestigatorEmployeeId: 'u1', targetDate: '2026-10-20' },
        names,
      ),
    ).toEqual([
      'Lead investigator assigned: Asha Patel',
      'Investigation level set: Enhanced',
      'Target completion date set: 20 Oct 2026',
    ]);
    expect(
      describeSetupChanges(
        { investigationLevel: 'ENHANCED', leadInvestigatorEmployeeId: 'u1', targetDate: '2026-10-20' },
        { investigationLevel: 'COMPREHENSIVE', leadInvestigatorEmployeeId: 'u2', targetDate: '2026-11-03' },
        names,
      ),
    ).toEqual([
      'Lead investigator changed: Asha Patel → Tom Reed',
      'Investigation level changed: Enhanced → Comprehensive',
      'Target completion date changed: 20 Oct 2026 → 3 Nov 2026',
    ]);
  });
});

describe('missingSetupForCompletion', () => {
  const full = {
    investigationLevel: 'STANDARD',
    leadInvestigatorEmployeeId: 'u1',
    targetDate: '2026-10-20',
    termsOfReference: 'Why was the medication missed?',
    investigatorInvolved: 'NO',
    investigatorInvolvedReason: null,
  };

  it('needs nothing when the set-up is complete', () => {
    expect(missingSetupForCompletion(full)).toEqual([]);
  });

  it('needs a reason when the investigator was involved', () => {
    expect(missingSetupForCompletion({ ...full, investigatorInvolved: 'YES' })).toEqual([
      'why the involved investigator is still appropriate',
    ]);
  });

  it('lists every missing answer', () => {
    expect(
      missingSetupForCompletion({
        investigationLevel: null,
        leadInvestigatorEmployeeId: null,
        targetDate: null,
        termsOfReference: '  ',
        investigatorInvolved: null,
        investigatorInvolvedReason: null,
      }),
    ).toHaveLength(5);
  });
});

it('formats day keys for UK readers', () => {
  expect(formatDayKey('2026-01-05')).toBe('5 Jan 2026');
  expect(formatDayKey(null)).toBe('—');
});

describe('describeEvidenceChanges', () => {
  const empty = {
    recordsReviewed: [],
    recordsReviewedDetails: null,
    evidenceNotes: null,
    outstandingEvidence: null,
  };

  it('adds nothing when evidence is unchanged', () => {
    const s = {
      recordsReviewed: ['CARE_PLAN', 'ROTA'],
      recordsReviewedDetails: { CARE_PLAN: { items: [{ id: 'cp1', label: 'Falls care plan' }] } },
      evidenceNotes: 'MAR gap on 3 Oct',
      outstandingEvidence: null,
    };
    expect(describeEvidenceChanges(s, { ...s })).toEqual([]);
  });

  it('describes kinds, links and notes', () => {
    expect(
      describeEvidenceChanges(empty, {
        recordsReviewed: ['CARE_PLAN', 'ROTA'],
        recordsReviewedDetails: { CARE_PLAN: { items: [{ id: 'cp1', label: 'Falls care plan' }] } },
        evidenceNotes: 'MAR gap',
        outstandingEvidence: 'GP report requested',
      }),
    ).toEqual([
      'Records reviewed: Care plan linked — Falls care plan',
      'Records reviewed: Rota',
      'Evidence notes added',
      'Outstanding evidence added',
    ]);
  });

  it('describes unlinking, removing a kind and clearing notes', () => {
    expect(
      describeEvidenceChanges(
        {
          recordsReviewed: ['CARE_PLAN', 'ROTA'],
          recordsReviewedDetails: { CARE_PLAN: { items: [{ id: 'cp1', label: 'Falls care plan' }] } },
          evidenceNotes: 'MAR gap',
          outstandingEvidence: 'GP report',
        },
        { ...empty, recordsReviewed: ['CARE_PLAN'], outstandingEvidence: 'GP report received' },
      ),
    ).toEqual([
      'Records reviewed: Care plan unlinked — Falls care plan',
      'Records reviewed: Rota removed',
      'Evidence notes cleared',
      'Outstanding evidence updated',
    ]);
  });
});
