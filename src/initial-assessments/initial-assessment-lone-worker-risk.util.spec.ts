import { InitialAssessmentRiskLevel, InitialAssessmentRiskType, Prisma } from '@prisma/client';
import { buildLoneWorkerRiskDraft } from './initial-assessment-lone-worker-risk.util';
import {
  buildAutoRiskRecordsFromSubmission,
  isLoneWorkerFactorQuestion,
} from './initial-assessment-risk-generation.util';

type Weight = 'high' | 'medium' | 'minor';

function loneWorkerQuestion(
  id: string,
  weight: Weight,
  questionText = `Factor ${id}`,
  sectionNumber = 1,
) {
  return {
    id,
    questionText,
    riskFlag: false,
    carePlanTrigger: false,
    metadata: { loneWorkerFactor: true, loneWorkerWeight: weight } as Prisma.JsonValue,
    section: { sectionNumber },
  };
}

function yesAnswer(questionId: string) {
  return { questionId, checked: null, booleanValue: true, riskFlag: false };
}
function noAnswer(questionId: string) {
  return { questionId, checked: null, booleanValue: false, riskFlag: false };
}

function envMeta(env: Record<string, unknown>): Prisma.JsonValue {
  return { environmentAssessment: env } as Prisma.JsonValue;
}

describe('buildLoneWorkerRiskDraft', () => {
  it('returns null when there are no factors and no explicit flag', () => {
    expect(
      buildLoneWorkerRiskDraft({ questions: [], answers: [], metadata: {} as Prisma.JsonValue }),
    ).toBeNull();
  });

  it('ignores tagged factor questions that were answered No', () => {
    const q = loneWorkerQuestion('q1', 'high');
    expect(
      buildLoneWorkerRiskDraft({ questions: [q], answers: [noAnswer('q1')], metadata: {} as Prisma.JsonValue }),
    ).toBeNull();
  });

  it('creates a risk when the assessor flags it even with no evidence (default Medium)', () => {
    const draft = buildLoneWorkerRiskDraft({
      questions: [],
      answers: [],
      metadata: envMeta({ loneWorkerRiskIdentified: true }),
    });
    expect(draft).not.toBeNull();
    expect(draft!.riskType).toBe(InitialAssessmentRiskType.LONE_WORKER);
    expect(draft!.riskLevel).toBe(InitialAssessmentRiskLevel.MEDIUM);
  });

  it('lets a manual risk level override the computed level', () => {
    const draft = buildLoneWorkerRiskDraft({
      questions: [],
      answers: [],
      // Only a single minor factor would compute Low, but manual says High.
      metadata: envMeta({
        isolatedProperty: true,
        loneWorkerRiskIdentified: true,
        loneWorkerRiskLevel: 'High',
      }),
    });
    expect(draft!.riskLevel).toBe(InitialAssessmentRiskLevel.HIGH);
  });

  it('scores High when any high-weight DB factor is present', () => {
    const q = loneWorkerQuestion('violence', 'high', 'Any history of physical violence?');
    const draft = buildLoneWorkerRiskDraft({
      questions: [q],
      answers: [yesAnswer('violence')],
      metadata: {} as Prisma.JsonValue,
    });
    expect(draft!.riskLevel).toBe(InitialAssessmentRiskLevel.HIGH);
    expect(draft!.description).toContain('physical violence');
  });

  it('scores High when a high-weight environment factor is present', () => {
    const draft = buildLoneWorkerRiskDraft({
      questions: [],
      answers: [],
      metadata: envMeta({ pastSafeguardingIncident: true }),
    });
    expect(draft!.riskLevel).toBe(InitialAssessmentRiskLevel.HIGH);
  });

  it('scores High for the works-alone + night-visits combo (both medium)', () => {
    const draft = buildLoneWorkerRiskDraft({
      questions: [],
      answers: [],
      metadata: envMeta({ carerWorksAlone: true, nightVisits: true }),
    });
    expect(draft!.riskLevel).toBe(InitialAssessmentRiskLevel.HIGH);
  });

  it('scores Medium for two independent medium factors', () => {
    const draft = buildLoneWorkerRiskDraft({
      questions: [],
      answers: [],
      metadata: envMeta({ unsafeArea: true, previousCarerComplaints: true }),
    });
    expect(draft!.riskLevel).toBe(InitialAssessmentRiskLevel.MEDIUM);
  });

  it('scores Low for a single minor factor', () => {
    const draft = buildLoneWorkerRiskDraft({
      questions: [],
      answers: [],
      metadata: envMeta({ isolatedProperty: true }),
    });
    expect(draft!.riskLevel).toBe(InitialAssessmentRiskLevel.LOW);
  });

  it('combines DB and environment factors into one risk', () => {
    const q = loneWorkerQuestion('agg', 'medium', 'Aggression towards carers?');
    const draft = buildLoneWorkerRiskDraft({
      questions: [q],
      answers: [yesAnswer('agg')],
      metadata: envMeta({ unsafeArea: true }),
    });
    // one medium (DB) + one medium (env) = 2 medium → Medium
    expect(draft!.riskLevel).toBe(InitialAssessmentRiskLevel.MEDIUM);
    expect(draft!.sourceQuestionId).toBeUndefined();
  });
});

describe('per-question engine suppresses lone-worker factors', () => {
  it('isLoneWorkerFactorQuestion detects the tag', () => {
    expect(isLoneWorkerFactorQuestion(loneWorkerQuestion('x', 'high'))).toBe(true);
    expect(
      isLoneWorkerFactorQuestion({ metadata: {} as Prisma.JsonValue }),
    ).toBe(false);
  });

  it('does not emit a per-question risk for a tagged factor (even with riskFlag + aggression text)', () => {
    const q = {
      id: 'agg',
      questionText: 'Any aggression towards carers?', // would map to LONE_WORKER via inferRiskType
      riskFlag: true,
      carePlanTrigger: false,
      metadata: { loneWorkerFactor: true, loneWorkerWeight: 'high' } as Prisma.JsonValue,
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
