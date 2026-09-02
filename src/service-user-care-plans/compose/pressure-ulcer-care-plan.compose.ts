/**
 * Pressure Ulcer Care Plan compose.
 *
 * Clinical PU fields are SUGGESTION on the approved matrix (Waterlow is
 * screening, not a diagnosis; a YES/NO gate is not a wound narrative).
 * Phase 1 disables silent AUTO-PREFILL. Manual Care 2020 fields stay omitted.
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

export const PRESSURE_ULCER_CARE_PLAN_FORM_NAME = 'Pressure Ulcer';

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

export const PRESSURE_ULCER_CARE_PLAN_FIELD_MAPPINGS: LabelFieldMapping[] = [
  { fieldLabel: 'Waterlow or risk score', resolve: () => null },
  { fieldLabel: 'Existing pressure areas or wounds', resolve: () => null },
  { fieldLabel: 'Pressure relieving equipment', resolve: () => null },
];

export function composePressureUlcerCarePlan(
  ctx: CarePlanComposeContext,
  fields: CarePlanFormFieldRef[],
  serviceUserId: string,
): ComposePlanResult {
  return composeLabelMappedForm(ctx, fields, PRESSURE_ULCER_CARE_PLAN_FIELD_MAPPINGS, {
    serviceUserId,
    initialEvidence: baseEvidence(ctx, serviceUserId),
    composedFrom: {
      formName: PRESSURE_ULCER_CARE_PLAN_FORM_NAME,
      iaSubmissionId: ctx.ia?.submissionId ?? null,
      composedAt: new Date().toISOString(),
    },
    fixesForField: () => [
      { label: 'Complete skin integrity / Waterlow section', route: iaRoute(serviceUserId, 11) },
    ],
  });
}
