// Mirror of careflow-admin specialist-relevance-rules.test.ts — both copies of the rules must agree.
import {
  applySpecialistOverride,
  overrideNeedsReason,
  SPECIALIST_TAB_IDS as T,
  specialistRelevanceFromInputs,
  type SpecialistInputs,
} from './initial-assessment-specialist-relevance.rules';

const blank: SpecialistInputs = {
  painConcerns: null,
  nutritionStatus: null,
  appetiteStatus: null,
  unableToWeigh: null,
  swallowingConcerns: null,
  capacityDoubt: null,
  understands: null,
  covertMedication: null,
  mcaRequired: null,
  dolRestrictions: null,
  dolConcern: null,
  skinCondition: null,
  hasWounds: null,
  restrictedToBed: null,
  usesHoist: null,
  independentAllTransfers: null,
  bladder: null,
  bowel: null,
  diabetic: null,
  mustScore: null,
  waterlowScore: null,
  adlScores: null,
  falls: {
    fallsLast12Months: null,
    unsteadiness: null,
    fearOfFalling: null,
    clinicalConcern: null,
  },
  furtherEquipment: null,
  fireRisks: null,
  smokeAlarmWorking: null,
  smoking: null,
  oxygen: null,
  hoarding: null,
  infectionPrecautions: null,
  bedRails: null,
  canSelfEvacuate: null,
  acpOffered: null,
  eolRelevant: null,
};

const status = (tabId: number, over: Partial<SpecialistInputs>) =>
  specialistRelevanceFromInputs(tabId, { ...blank, ...over })?.status;

describe('specialist relevance', () => {
  it('never treats an unanswered screen as required', () => {
    for (const tabId of Object.values(T)) {
      if (tabId === T.mcaChecklist) continue;
      expect(status(tabId, {})).toBe('pending');
    }
  });

  it('returns null for core tabs', () => {
    expect(specialistRelevanceFromInputs(1, blank)).toBeNull();
    expect(specialistRelevanceFromInputs(23, blank)).toBeNull();
  });

  it('pain: severity or unable-to-report is required, no concern is not needed', () => {
    expect(status(T.pain, { painConcerns: ['moderate_movement'] })).toBe(
      'required',
    );
    expect(status(T.pain, { painConcerns: ['unable_to_self_report'] })).toBe(
      'required',
    );
    expect(status(T.pain, { painConcerns: ['no_concern'] })).toBe('not_needed');
    expect(
      status(T.pain, { painConcerns: ['pain_assessment_completed'] }),
    ).toBe('not_needed');
  });

  it('MCA: capacity doubt or covert medication is required; understanding doubt is suggested', () => {
    expect(status(T.mca, { capacityDoubt: true })).toBe('required');
    expect(
      status(T.mca, { capacityDoubt: false, covertMedication: true }),
    ).toBe('required');
    expect(status(T.mca, { capacityDoubt: false, understands: 'unsure' })).toBe(
      'suggested',
    );
    expect(status(T.mca, { capacityDoubt: false })).toBe('not_needed');
    expect(
      status(T.mca, {
        capacityDoubt: false,
        dolRestrictions: ['continuous_supervision'],
      }),
    ).toBe('required');
    expect(
      status(T.mca, { capacityDoubt: false, dolRestrictions: ['none'] }),
    ).toBe('not_needed');
  });

  it('moving & handling follows hoist, bed-bound and ADL dependency', () => {
    expect(status(T.movingHandling, { usesHoist: true })).toBe('required');
    expect(status(T.movingHandling, { adlScores: { chair_transfer: 2 } })).toBe(
      'required',
    );
    expect(status(T.movingHandling, { adlScores: { walking: 1 } })).toBe(
      'suggested',
    );
    expect(
      status(T.movingHandling, { adlScores: { walking: 0, bed_transfer: 0 } }),
    ).toBe('pending');
    expect(
      status(T.movingHandling, {
        adlScores: { walking: 0 },
        independentAllTransfers: true,
      }),
    ).toBe('not_needed');
  });

  it('Waterlow / equipment / skin follow the pressure picture', () => {
    expect(status(T.waterlow, { restrictedToBed: true })).toBe('required');
    expect(
      status(T.waterlow, {
        skinCondition: false,
        hasWounds: false,
        bladder: ['no_concern'],
        bowel: ['no_concern'],
      }),
    ).toBe('not_needed');
    expect(status(T.equipment, { waterlowScore: 14 })).toBe('required');
    expect(status(T.equipment, { waterlowScore: 6 })).toBe('not_needed');
    expect(status(T.skin, { hasWounds: true })).toBe('required');
    expect(
      status(T.skin, {
        skinCondition: false,
        hasWounds: false,
        waterlowScore: 12,
      }),
    ).toBe('suggested');
  });

  it('fire, PEEP, bed rails, infection', () => {
    expect(status(T.fire, { oxygen: true })).toBe('required');
    expect(status(T.fire, { fireRisks: false, smokeAlarmWorking: true })).toBe(
      'not_needed',
    );
    expect(status(T.peep, { canSelfEvacuate: false })).toBe('required');
    expect(
      status(T.peep, { canSelfEvacuate: true, restrictedToBed: true }),
    ).toBe('suggested');
    expect(status(T.bedRails, { bedRails: false })).toBe('not_needed');
    expect(status(T.infection, { infectionPrecautions: true })).toBe(
      'required',
    );
  });

  it('ACP is person-led and End of Life is never decided by the assessor', () => {
    expect(status(T.acp, { acpOffered: 'yes_now' })).toBe('required');
    expect(status(T.acp, { acpOffered: 'declined' })).toBe('not_needed');
    expect(status(T.eol, { eolRelevant: 'yes' })).toBe('required');
    expect(status(T.eol, { eolRelevant: 'no' })).toBe('not_needed');
    const unsure = specialistRelevanceFromInputs(T.eol, {
      ...blank,
      eolRelevant: 'unsure',
    });
    expect(unsure?.status).toBe('pending');
    expect(unsure?.pendingHint).toMatch(/clinical clarification/i);
  });

  it('therapy needs are only ever suggested', () => {
    expect(
      status(T.therapy, {
        usesHoist: true,
        falls: { ...blank.falls, fallsLast12Months: true },
      }),
    ).toBe('suggested');
  });
});

describe('overrides', () => {
  it('downgrading a trigger needs a reason; upgrading does not', () => {
    expect(overrideNeedsReason('required', 'not_needed')).toBe(true);
    expect(overrideNeedsReason('suggested', 'not_needed')).toBe(true);
    expect(overrideNeedsReason('not_needed', 'required')).toBe(false);
  });

  it('ignores a reasonless downgrade and applies a reasoned one', () => {
    const computed = { status: 'required' as const, reasons: ['Hoist in use'] };
    expect(
      applySpecialistOverride(computed, { status: 'not_needed', at: 'x' })
        .status,
    ).toBe('required');
    const applied = applySpecialistOverride(computed, {
      status: 'not_needed',
      reason: 'OT confirmed',
      at: 'x',
    });
    expect(applied.status).toBe('not_needed');
    expect(applied.reasons[0]).toContain('OT confirmed');
  });
});
