/**
 * Sleeping and Night Care Plan compose.
 *
 * IA §10.4 sleepingPattern is hours-of-sleep / medication / GP-referral, not bedtime, waking,
 * confusion, naps, call bell, or drinks. About Me nightSupport and IA §1.4 daily routine
 * already belong to Person Centred / Dementia. Sleeping-pattern-concern is an assessment
 * gate, not area-risk. This engine therefore AUTO-PREFILLS nothing — mappings stay empty so
 * every field remains MANUAL.
 */
import type {
  CarePlanComposeContext,
  CarePlanFormFieldRef,
  ComposePlanResult,
} from './compose-context.types';
import {
  composeLabelMappedForm,
  type LabelFieldMapping,
} from './label-mapped-compose.util';
import { iaRoute } from './compose-routes.util';

export const SLEEPING_NIGHT_CARE_PLAN_FORM_NAME = 'Sleeping and Night';

function baseEvidence(ctx: CarePlanComposeContext, serviceUserId: string) {
  return ctx.ia
    ? [
        {
          id: 'ia-submission',
          source: 'ia' as const,
          label: 'Initial Assessment',
          value: ctx.ia.submittedAt
            ? `Submitted ${ctx.ia.submittedAt.slice(0, 10)}`
            : 'Submitted assessment on file',
          route: iaRoute(serviceUserId),
        },
      ]
    : [];
}

/** Empty by design — no genuine 1:1 IA source for Sleeping and Night fields. */
export const SLEEPING_NIGHT_CARE_PLAN_FIELD_MAPPINGS: LabelFieldMapping[] = [];

export function composeSleepingNightCarePlan(
  ctx: CarePlanComposeContext,
  fields: CarePlanFormFieldRef[],
  serviceUserId: string,
): ComposePlanResult {
  return composeLabelMappedForm(ctx, fields, SLEEPING_NIGHT_CARE_PLAN_FIELD_MAPPINGS, {
    serviceUserId,
    initialEvidence: baseEvidence(ctx, serviceUserId),
    composedFrom: {
      formName: SLEEPING_NIGHT_CARE_PLAN_FORM_NAME,
      iaSubmissionId: ctx.ia?.submissionId ?? null,
      composedAt: new Date().toISOString(),
    },
    fixesForField: () => [
      { label: 'Complete mental health / sleep section', route: iaRoute(serviceUserId, 10) },
    ],
  });
}
