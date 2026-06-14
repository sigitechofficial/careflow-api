import type {
  CarePlanComposeContext,
  CarePlanFormFieldRef,
  ComposeGap,
  ComposeEvidenceItem,
  ComposePlanResult,
} from './compose-context.types';
import {
  findIaAnswer,
  mapMedicationSupportLevelToCarePlan,
  resolveIaDisplayValue,
  resolveIaRawValue,
} from './ia-answer-resolver.util';
import { composeLabelMappedForm, mergeEvidence, type LabelFieldMapping } from './label-mapped-compose.util';
import { iaRoute, medRoute } from './compose-routes.util';
import { getCarePlanReviewSchedule, computeNextReviewDueAt } from '../care-plan-review-schedule';

const REVIEW_FORM_NAME = 'Care Plan review form';

function isoDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function joinIaAnswers(ctx: CarePlanComposeContext, queries: Array<{ specRef?: string; fieldKey?: string; contains?: string }>): string | null {
  if (!ctx.ia) return null;
  const lines = queries
    .map((q) =>
      resolveIaDisplayValue(
        findIaAnswer(ctx.ia!.answers, {
          fieldKey: q.fieldKey,
          specRef: q.specRef,
          questionTextContains: q.contains,
        }),
      ),
    )
    .filter(Boolean) as string[];
  return lines.length > 0 ? lines.join('\n') : null;
}

export const CARE_PLAN_REVIEW_FIELD_MAPPINGS: LabelFieldMapping[] = [
  {
    fieldLabel: 'Review date',
    required: true,
    resolve: () => ({
      fieldKey: '',
      label: 'Review date',
      value: isoDateOnly(new Date()),
      source: 'static',
      sourceLabel: 'Today',
    }),
  },
  {
    fieldLabel: 'Overall physical wellbeing',
    resolve: (ctx) => {
      const text = joinIaAnswers(ctx, [{ fieldKey: 'generalPhysicalWellbeing' }]);
      if (!text) return null;
      return { fieldKey: '', label: 'Overall physical wellbeing', value: text, source: 'ia', sourceLabel: 'IA §4' };
    },
  },
  {
    fieldLabel: 'Primary diagnoses and conditions',
    resolve: (ctx) => {
      const text = joinIaAnswers(ctx, [
        { specRef: '5.1', contains: 'breathing condition details' },
        { specRef: '5.1', contains: 'breathing action plan' },
        { specRef: '4.6', contains: 'general physical' },
      ]);
      if (!text) return null;
      return {
        fieldKey: '',
        label: 'Primary diagnoses and conditions',
        value: text,
        source: 'ia',
        sourceLabel: 'IA §4–§5',
      };
    },
  },
  {
    fieldLabel: 'Equipment in use',
    resolve: (ctx) => {
      const text = joinIaAnswers(ctx, [
        { fieldKey: 'usesHoistOrSling' },
        { specRef: '11.3', contains: 'pressure equipment details' },
        { specRef: '12.10', contains: 'further equipment details' },
      ]);
      if (!text) return null;
      return { fieldKey: '', label: 'Equipment in use', value: text, source: 'ia', sourceLabel: 'IA §11–§12' };
    },
  },
  {
    fieldLabel: 'Environmental risks and access',
    resolve: (ctx) => {
      const text = joinIaAnswers(ctx, [
        { fieldKey: 'accessInstructions' },
        { specRef: '3.8', contains: 'smoking in property' },
        { specRef: '3.12', contains: 'car parking control measures' },
      ]);
      if (!text) return null;
      return {
        fieldKey: '',
        label: 'Environmental risks and access',
        value: text,
        source: 'ia',
        sourceLabel: 'IA §3',
      };
    },
  },
  {
    fieldLabel: 'Eating and drinking support',
    resolve: (ctx) => {
      const text = joinIaAnswers(ctx, [
        { fieldKey: 'eatingAssistanceLevel' },
        { specRef: '6.1', contains: 'eating / drinking equipment details' },
      ]);
      if (!text) return null;
      return {
        fieldKey: '',
        label: 'Eating and drinking support',
        value: text,
        source: 'ia',
        sourceLabel: 'IA §6',
      };
    },
  },
  {
    fieldLabel: 'Nutrition status and concerns',
    resolve: (ctx) => {
      const text = joinIaAnswers(ctx, [
        { fieldKey: 'nutritionStatus' },
        { fieldKey: 'nutritionalSupplementsPrescribed' },
        { specRef: '6.4', contains: 'nutrition' },
      ]);
      if (!text) return null;
      return {
        fieldKey: '',
        label: 'Nutrition status and concerns',
        value: text,
        source: 'ia',
        sourceLabel: 'IA §6',
      };
    },
  },
  {
    fieldLabel: 'Medication support level',
    resolve: (ctx) => {
      if (!ctx.ia) return null;
      const mapped = mapMedicationSupportLevelToCarePlan(
        resolveIaRawValue(findIaAnswer(ctx.ia.answers, { fieldKey: 'medicationSupportLevel' })),
      );
      if (!mapped) return null;
      return {
        fieldKey: '',
        label: 'Medication support level',
        value: mapped,
        source: 'ia',
        sourceLabel: 'IA §9',
      };
    },
  },
  {
    fieldLabel: 'Active medications summary',
    resolve: (ctx) => {
      const parts = [ctx.emar.medListText, ctx.emar.prnText ? `PRN:\n${ctx.emar.prnText}` : ''].filter(Boolean);
      if (parts.length === 0) return null;
      return {
        fieldKey: '',
        label: 'Active medications summary',
        value: parts.join('\n\n'),
        source: 'emar',
        sourceLabel: 'eMAR',
      };
    },
  },
  {
    fieldLabel: 'Capacity and consent summary',
    resolve: (ctx) => {
      const text = joinIaAnswers(ctx, [
        { fieldKey: 'consentGivenBy' },
        { specRef: '2.4', contains: 'capacity to consent' },
      ]);
      if (!text) return null;
      return {
        fieldKey: '',
        label: 'Capacity and consent summary',
        value: text,
        source: 'ia',
        sourceLabel: 'IA §2',
      };
    },
  },
  {
    fieldLabel: 'Cognitive and emotional summary',
    resolve: (ctx) => {
      const text = joinIaAnswers(ctx, [
        { fieldKey: 'emotionalWellbeing' },
        { fieldKey: 'sleepingPattern' },
        { specRef: '10.1', contains: 'emotional health comments' },
      ]);
      if (!text) return null;
      return {
        fieldKey: '',
        label: 'Cognitive and emotional summary',
        value: text,
        source: 'ia',
        sourceLabel: 'IA §10',
      };
    },
  },
  {
    fieldLabel: 'Next review date',
    resolve: () => {
      const schedule = getCarePlanReviewSchedule(REVIEW_FORM_NAME);
      const next = computeNextReviewDueAt(new Date(), schedule.defaultIntervalDays);
      return {
        fieldKey: '',
        label: 'Next review date',
        value: isoDateOnly(next),
        source: 'static',
        sourceLabel: 'Six-monthly schedule',
      };
    },
  },
];

function buildReviewFixes(label: string, serviceUserId: string): ComposeGap['fixes'] {
  const ia = iaRoute(serviceUserId);
  switch (label.toLowerCase()) {
    case 'reviewer name and role':
      return [{ label: 'Complete IA §14 reviewer details', route: iaRoute(serviceUserId, 14) }];
    case 'active medications summary':
      return [{ label: 'Add medications in eMAR', route: medRoute(serviceUserId) }];
    default:
      return [{ label: 'Review Initial Assessment', route: ia }];
  }
}

export function composeCarePlanReviewForm(
  ctx: CarePlanComposeContext,
  fields: CarePlanFormFieldRef[],
  serviceUserId: string,
): ComposePlanResult {
  let evidence: ComposeEvidenceItem[] = [];

  if (ctx.ia) {
    evidence = mergeEvidence(evidence, {
      id: 'ia-submission',
      source: 'ia',
      label: 'Initial Assessment',
      value: ctx.ia.submittedAt
        ? `Submitted ${ctx.ia.submittedAt.slice(0, 10)}`
        : 'Submitted assessment on file',
      route: iaRoute(serviceUserId),
    });
  }

  if (ctx.emar.activeCount > 0) {
    evidence = mergeEvidence(evidence, {
      id: 'emar-active',
      source: 'emar',
      label: 'eMAR',
      value: `${ctx.emar.activeCount} active medication(s)`,
      route: medRoute(serviceUserId),
    });
  }

  return composeLabelMappedForm(ctx, fields, CARE_PLAN_REVIEW_FIELD_MAPPINGS, {
    serviceUserId,
    initialEvidence: evidence,
    fixesForField: buildReviewFixes,
    composedFrom: {
      iaSubmissionId: ctx.ia?.submissionId ?? null,
      emarActiveCount: ctx.emar.activeCount,
      composedAt: new Date().toISOString(),
      mapping: 'care-plan-review',
    },
  });
}
