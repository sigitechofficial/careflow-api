import type { CarePlanReassessmentChange } from '@prisma/client';
import type { CarePlanRecommendation } from './initial-assessment-care-plan.util';

export type ReassessmentRisk = {
  riskType: string;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
};
export type ReassessmentPlan = {
  instanceId: string;
  carePathwayFormId: string;
  formName: string;
  /** Risk types of IA risk records linked to this plan. */
  linkedRiskTypes: string[];
};
export type ReassessmentFlagDraft = {
  instanceId: string;
  changeTypes: CarePlanReassessmentChange[];
  reason: string;
  details: Record<string, unknown>;
};

const LEVEL = { LOW: 1, MEDIUM: 2, HIGH: 3 } as const;

function evidenceByForm(recs: CarePlanRecommendation[]) {
  const map = new Map<string, Set<string>>();
  for (const rec of recs) {
    if (!rec.carePathwayFormId) continue;
    const set = map.get(rec.carePathwayFormId) ?? new Set<string>();
    rec.triggers.forEach((t) => set.add(t.questionId));
    map.set(rec.carePathwayFormId, set);
  }
  return map;
}

function maxLevelByType(risks: ReassessmentRisk[]) {
  const map = new Map<string, number>();
  for (const r of risks)
    map.set(r.riskType, Math.max(map.get(r.riskType) ?? 0, LEVEL[r.riskLevel]));
  return map;
}

/**
 * Which active care plans a new assessment affects, from structured evidence only: recommendation
 * targets and their trigger questions, and risk types / levels. With no earlier assessment to compare
 * against, every active plan gets a GENERAL review flag rather than a guessed conclusion.
 */
export function computeReassessmentFlags(input: {
  plans: ReassessmentPlan[];
  current: {
    recommendations: CarePlanRecommendation[];
    risks: ReassessmentRisk[];
  };
  previous: {
    recommendations: CarePlanRecommendation[];
    risks: ReassessmentRisk[];
  } | null;
}): ReassessmentFlagDraft[] {
  if (!input.previous) {
    return input.plans.map((p) => ({
      instanceId: p.instanceId,
      changeTypes: ['GENERAL'],
      reason:
        'A new initial assessment was completed and there is no earlier assessment to compare it with. Review this care plan against it.',
      details: {},
    }));
  }
  const before = evidenceByForm(input.previous.recommendations);
  const now = evidenceByForm(input.current.recommendations);
  const riskBefore = maxLevelByType(input.previous.risks);
  const riskNow = maxLevelByType(input.current.risks);
  const newOrHigherRisks = [...riskNow.entries()]
    .filter(([type, level]) => level > (riskBefore.get(type) ?? 0))
    .map(([type]) => type);

  const flags: ReassessmentFlagDraft[] = [];
  for (const plan of input.plans) {
    const prev = before.get(plan.carePathwayFormId);
    const cur = now.get(plan.carePathwayFormId);
    const changeTypes: CarePlanReassessmentChange[] = [];
    const reasons: string[] = [];
    const details: Record<string, unknown> = {};
    if (!prev && cur) {
      changeTypes.push('NEW_NEED');
      reasons.push('the latest assessment now recommends this care plan');
      details.newTriggerQuestionIds = [...cur];
    } else if (prev && !cur) {
      changeTypes.push('NO_LONGER_INDICATED');
      reasons.push('the latest assessment no longer recommends this care plan');
      details.previousTriggerQuestionIds = [...prev];
    } else if (prev && cur) {
      const added = [...cur].filter((q) => !prev.has(q));
      const removed = [...prev].filter((q) => !cur.has(q));
      if (added.length || removed.length) {
        changeTypes.push('CHANGED_NEED');
        reasons.push(
          'the assessment answers behind this care plan have changed',
        );
        details.addedTriggerQuestionIds = added;
        details.removedTriggerQuestionIds = removed;
      }
    }
    const risks = plan.linkedRiskTypes.filter((t) =>
      newOrHigherRisks.includes(t),
    );
    if (risks.length) {
      changeTypes.push('NEW_RISK');
      reasons.push(`a linked risk is new or higher (${risks.join(', ')})`);
      details.newOrHigherRiskTypes = risks;
    }
    if (changeTypes.length) {
      flags.push({
        instanceId: plan.instanceId,
        changeTypes,
        reason: `Reassessment: ${reasons.join('; ')}. Review ${plan.formName}.`,
        details,
      });
    }
  }
  return flags;
}
