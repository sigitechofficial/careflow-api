import { InitialAssessmentRiskLevel, InitialAssessmentRiskType, Prisma } from '@prisma/client';
import { buildLoneWorkerRiskDraft, extractLoneWorkerBriefing } from './initial-assessment-lone-worker-risk.util';
import {
  buildAutoRiskRecordsFromSubmission,
  isLoneWorkerFactorQuestion,
} from './initial-assessment-risk-generation.util';

/** Lone-worker factors now live in the Environment Assessment snapshot. */
function envMeta(env: Record<string, unknown>): Prisma.JsonValue {
  return { environmentAssessment: env } as Prisma.JsonValue;
}

function draft(env: Record<string, unknown>) {
  return buildLoneWorkerRiskDraft({ questions: [], answers: [], metadata: envMeta(env) });
}

describe('buildLoneWorkerRiskDraft (Likelihood × Severity matrix)', () => {
  it('returns null when there are no factors and no explicit flag', () => {
    expect(buildLoneWorkerRiskDraft({ questions: [], answers: [], metadata: {} as Prisma.JsonValue })).toBeNull();
    expect(draft({ unsafeArea: false })).toBeNull();
  });

  it('creates a risk when the assessor flags it even with no evidence (default Medium)', () => {
    const d = draft({ loneWorkerRiskIdentified: true });
    expect(d).not.toBeNull();
    expect(d!.riskType).toBe(InitialAssessmentRiskType.LONE_WORKER);
    expect(d!.riskLevel).toBe(InitialAssessmentRiskLevel.MEDIUM);
  });

  it('lets a manual risk level override the computed level (and matrix cell)', () => {
    const d = draft({ isolatedProperty: true, loneWorkerRiskIdentified: true, loneWorkerRiskLevel: 'High' });
    expect(d!.riskLevel).toBe(InitialAssessmentRiskLevel.HIGH);
    expect(d!.likelihood).toBe(InitialAssessmentRiskLevel.HIGH);
    expect(d!.severity).toBe(InitialAssessmentRiskLevel.HIGH);
  });

  it('High × High factors (physical violence) score High', () => {
    const d = draft({ physicalViolence: true });
    expect(d!.likelihood).toBe(InitialAssessmentRiskLevel.HIGH);
    expect(d!.severity).toBe(InitialAssessmentRiskLevel.HIGH);
    expect(d!.riskLevel).toBe(InitialAssessmentRiskLevel.HIGH);
    expect(d!.description).toContain('physical violence');
  });

  it('aggression (High likelihood × Medium severity) scores High', () => {
    // 3 × 2 = 6 → High
    expect(draft({ aggression: true })!.riskLevel).toBe(InitialAssessmentRiskLevel.HIGH);
  });

  it('past safeguarding incident scores High', () => {
    expect(draft({ pastSafeguardingIncident: true })!.riskLevel).toBe(InitialAssessmentRiskLevel.HIGH);
  });

  it('a single minor-severity factor is Low', () => {
    // isolatedProperty: likelihood Low(1) × severity Medium(2) = 2 → Low
    expect(draft({ isolatedProperty: true })!.riskLevel).toBe(InitialAssessmentRiskLevel.LOW);
  });

  it('unsafe area (Medium × Medium) is Medium', () => {
    // 2 × 2 = 4 → Medium
    expect(draft({ unsafeArea: true })!.riskLevel).toBe(InitialAssessmentRiskLevel.MEDIUM);
  });

  it('unsafe area + no mobile signal escalates severity to High → High', () => {
    // likelihood Medium(2) × severity High(3) = 6 → High
    expect(draft({ unsafeArea: true, noMobileSignal: true })!.riskLevel).toBe(
      InitialAssessmentRiskLevel.HIGH,
    );
  });

  it('works alone + night visits pushes severity to High (Low × High = Medium)', () => {
    const d = draft({ carerWorksAlone: true, nightVisits: true });
    expect(d!.severity).toBe(InitialAssessmentRiskLevel.HIGH);
    expect(d!.riskLevel).toBe(InitialAssessmentRiskLevel.MEDIUM);
  });
});

describe('extractLoneWorkerBriefing (carer app visit briefing)', () => {
  it('lists Yes factors with their Risk Details and the control measures', () => {
    const b = extractLoneWorkerBriefing(
      envMeta({
        physicalViolence: true,
        physicalViolenceDetails: 'Pushed a carer last month.',
        unsafeArea: true,
        staffSafetyInstructions: 'Two carers required; call office on arrival.',
      }),
    );
    const violence = b.factors.find((f) => /physical violence/i.test(f.label));
    expect(violence?.detail).toBe('Pushed a carer last month.');
    expect(b.factors.some((f) => /unsafe area/i.test(f.label))).toBe(true);
    expect(b.controlMeasures).toBe('Two carers required; call office on arrival.');
  });

  it('returns empty factors + null control measures when nothing is set', () => {
    const b = extractLoneWorkerBriefing({} as Prisma.JsonValue);
    expect(b.factors).toEqual([]);
    expect(b.controlMeasures).toBeNull();
  });
});

describe('per-question engine suppresses lone-worker factors', () => {
  it('isLoneWorkerFactorQuestion detects the tag', () => {
    expect(
      isLoneWorkerFactorQuestion({
        metadata: { loneWorkerFactor: true } as Prisma.JsonValue,
      }),
    ).toBe(true);
    expect(isLoneWorkerFactorQuestion({ metadata: {} as Prisma.JsonValue })).toBe(false);
  });

  it('does not emit a per-question risk for a tagged factor (even with riskFlag + aggression text)', () => {
    const q = {
      id: 'agg',
      questionText: 'Any aggression towards carers?',
      riskFlag: true,
      carePlanTrigger: false,
      metadata: { loneWorkerFactor: true } as Prisma.JsonValue,
      section: { sectionNumber: 1 },
    };
    const drafts = buildAutoRiskRecordsFromSubmission({
      questions: [q],
      answers: [{ questionId: 'agg', checked: true, booleanValue: null, riskFlag: true }],
      metadata: {} as Prisma.JsonValue,
    });
    expect(drafts.find((d) => d.riskType === InitialAssessmentRiskType.LONE_WORKER)).toBeUndefined();
  });
});
