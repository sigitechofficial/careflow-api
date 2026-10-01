import {
  capacityDecisionGaps,
  capacityDecisionIssues,
  capacityDecisionNeeds,
  capacityDecisionForCarers,
  completedDecisionFor,
  indicatedOutcome,
  isCapacityDecisionComplete,
  normalizeCapacityDecisions,
  refusalContextFromDecision,
  type CapacityDecisionRecord,
  type CapacityDecisionTriggers,
} from './initial-assessment-capacity-decisions.util';

const NO_TRIGGERS: CapacityDecisionTriggers = {
  capacityDoubt: false,
  covertMedication: false,
  dolRestrictions: ['none'],
  dolConcern: null,
};

function hasCapacity(
  decision: CapacityDecisionRecord['decision'] = 'consent_to_care',
): CapacityDecisionRecord {
  return {
    id: `r-${decision}`,
    decision,
    relevantInformation: 'Visit times, tasks, what happens if care is refused',
    practicableSteps: 'Quiet room, large print, daughter present',
    understand: 'yes',
    retain: 'yes',
    weigh: 'yes',
    communicate: 'yes',
    outcome: 'has_capacity',
    wishes: 'Wants help in the mornings only',
    objection: 'no',
    assessorName: 'A. Assessor',
    assessedOn: '2026-09-20',
  };
}

function lacksCapacity(
  extra: Partial<CapacityDecisionRecord> = {},
): CapacityDecisionRecord {
  return {
    ...hasCapacity(),
    weigh: 'no',
    impairment: 'yes',
    causativeNexus: 'yes',
    outcome: 'lacks_capacity',
    authorityCovers: 'no',
    bestInterestsDecisionMaker: 'Registered manager',
    bestInterestsConsulted: 'Daughter, GP',
    bestInterestsOutcome:
      'Morning and evening visits, least restrictive option',
    ...extra,
  };
}

describe('indicatedOutcome (functional test first)', () => {
  it('is not decided until all four functional questions are answered', () => {
    expect(indicatedOutcome({ id: 'x', understand: 'yes' })).toBeNull();
  });

  it('able on every step → has capacity; unable + impairment + causal link → lacks', () => {
    expect(indicatedOutcome(hasCapacity())).toBe('has_capacity');
    expect(indicatedOutcome(lacksCapacity())).toBe('lacks_capacity');
  });

  it('unable but not because of an impairment → has capacity (an unwise decision is not incapacity)', () => {
    expect(indicatedOutcome({ ...lacksCapacity(), causativeNexus: 'no' })).toBe(
      'has_capacity',
    );
    expect(indicatedOutcome({ ...lacksCapacity(), impairment: 'no' })).toBe(
      'has_capacity',
    );
  });
});

describe('capacityDecisionGaps', () => {
  it('a complete has-capacity record has no gaps', () => {
    expect(capacityDecisionGaps(hasCapacity())).toEqual([]);
    expect(isCapacityDecisionComplete(hasCapacity())).toBe(true);
  });

  it("always needs the person's wishes and whether they object — whatever the outcome", () => {
    const gaps = capacityDecisionGaps({
      ...hasCapacity(),
      wishes: '',
      objection: undefined,
    });
    expect(gaps).toContain("the person's wishes");
    expect(gaps).toContain('whether the person objects');
    expect(capacityDecisionGaps(lacksCapacity({ objection: 'yes' }))).toContain(
      'how the person objects',
    );
  });

  it('lacks capacity needs a covering authority or a best-interests decision', () => {
    expect(
      capacityDecisionGaps(lacksCapacity({ authorityCovers: undefined })),
    ).toContain('whether a legal authority covers this decision');
    expect(
      capacityDecisionGaps(lacksCapacity({ bestInterestsOutcome: '' })),
    ).toContain('best-interests outcome');
    expect(
      capacityDecisionGaps(
        lacksCapacity({
          authorityCovers: 'yes',
          authorityDetails: 'H&W LPA — daughter',
        }),
      ),
    ).toEqual([]);
  });

  it('an outcome that differs from the answers needs a reason', () => {
    const r = {
      ...hasCapacity(),
      outcome: 'lacks_capacity' as const,
      authorityCovers: 'yes' as const,
      authorityDetails: 'Deputy',
    };
    expect(capacityDecisionGaps(r)).toContain(
      'reason the outcome differs from the answers',
    );
  });
});

describe('capacityDecisionNeeds', () => {
  it('nothing is needed while capacity is presumed', () => {
    expect(capacityDecisionNeeds(NO_TRIGGERS)).toEqual([]);
  });

  it('doubt → consent to care; covert medication and a DoL concern → their own decisions', () => {
    const needs = capacityDecisionNeeds({
      capacityDoubt: true,
      covertMedication: true,
      dolRestrictions: ['continuous_supervision'],
      dolConcern: 'unsure',
    });
    expect(needs.filter((n) => n.required).map((n) => n.decision)).toEqual([
      'consent_to_care',
      'covert_medication',
      'care_arrangements',
    ]);
  });

  it('restrictions without a concern are only suggested; bed rails suggest their own decision', () => {
    const needs = capacityDecisionNeeds({
      ...NO_TRIGGERS,
      dolRestrictions: ['bed_rails_or_belts'],
    });
    expect(needs).toEqual([
      {
        decision: 'bed_rails',
        reason: 'Bed rails or lap belts',
        required: false,
      },
    ]);
  });
});

describe('capacityDecisionIssues', () => {
  it('blocks each started record that is incomplete, naming what is missing', () => {
    const { blocks } = capacityDecisionIssues(
      [{ id: 'a', decision: 'photography' }],
      NO_TRIGGERS,
      false,
    );
    expect(blocks[0]).toMatch(
      /^Capacity assessment incomplete — Clinical photography: /,
    );
  });

  it('requires a record for each required decision (skippable "Required:" message)', () => {
    const triggers = { ...NO_TRIGGERS, capacityDoubt: true };
    expect(capacityDecisionIssues([], triggers, false).blocks).toEqual([
      'Required: capacity assessment for "Consent to the proposed care" — Reason to doubt capacity (Consent)',
    ]);
    expect(
      capacityDecisionIssues([hasCapacity()], triggers, false).blocks,
    ).toEqual([]);
    // A record for a different decision does not count.
    expect(
      capacityDecisionIssues([hasCapacity('photography')], triggers, false)
        .blocks,
    ).toHaveLength(1);
  });

  it('an objection from a person lacking capacity goes to a manager — it is never ignored', () => {
    const { warnings } = capacityDecisionIssues(
      [
        lacksCapacity({
          objection: 'yes',
          objectionDetails: 'Pushes carers away at night',
        }),
      ],
      NO_TRIGGERS,
      false,
    );
    expect(warnings.some((w) => /objects — manager review/.test(w))).toBe(true);
  });

  it('old IAs with only the global screening keep the old rules', () => {
    expect(
      capacityDecisionIssues([], { ...NO_TRIGGERS, capacityDoubt: true }, true),
    ).toEqual({
      blocks: [],
      warnings: [],
    });
  });
});

describe('refusalContextFromDecision', () => {
  it('with capacity the refusal stands; lacking capacity needs a best-interests decision or authority', () => {
    expect(refusalContextFromDecision(hasCapacity())).toMatchObject({
      hasCapacity: true,
      lacksCapacity: false,
    });
    expect(refusalContextFromDecision(lacksCapacity())).toMatchObject({
      lacksCapacity: true,
      bestInterestRecorded: true,
      coveringAuthority: false,
    });
    expect(refusalContextFromDecision(undefined)).toBeNull();
  });
});

describe('records over time', () => {
  it('uses the latest complete record for a decision and drops malformed rows', () => {
    const later = { ...lacksCapacity(), id: 'later' };
    expect(
      completedDecisionFor([hasCapacity(), later], 'consent_to_care')?.id,
    ).toBe('later');
    expect(
      normalizeCapacityDecisions([
        hasCapacity(),
        null,
        { decision: 'x' },
        'bad',
      ]),
    ).toHaveLength(1);
  });

  it('carer summary says who decides and carries the wishes / objection', () => {
    const s = capacityDecisionForCarers(
      lacksCapacity({ objection: 'yes', objectionDetails: 'x' }),
    );
    expect(s.status).toBe('lacks_capacity');
    expect(s.note).toMatch(
      /Best-interests decision: Morning and evening visits/,
    );
    expect(s.note).toMatch(/Their wishes: Wants help in the mornings only/);
    expect(s.note).toMatch(/They object — see office\./);
    expect(capacityDecisionForCarers(hasCapacity()).note).toMatch(
      /^The person makes this decision\./,
    );
  });
});
