/**
 * Washing and dressing Care Plan compose.
 *
 * AUTO-PREFILL is limited to "Gender of carer preferred": IA §1.6 "Staff gender preference
 * for personal care" SELECT codes are mapped to their clinician-facing labels (Male / Female /
 * No preference / Case by case). Culture/Religion already suggests the same IA fact for its
 * own free-text field; that engine is left unchanged and is not a source here.
 *
 * Every other field is MANUAL. Combined bathing/dressing narratives, visit times, ADL /
 * HSP assistance, HCP/HSP/Person Centred personal-care fields, Waterlow, MUST, Skin Integrity,
 * oral-health-concern, and dental-referral must not be mapped.
 */
import type {
  CarePlanComposeContext,
  CarePlanFormFieldRef,
  ComposeFieldResult,
  ComposePlanResult,
} from './compose-context.types';
import {
  composeLabelMappedForm,
  type LabelFieldMapping,
} from './label-mapped-compose.util';
import { findIaAnswer, resolveIaDisplayValue, resolveIaRawValue } from './ia-answer-resolver.util';
import { sanitizeComposeTextOrNull } from './compose-html-sanitize.util';
import { iaRoute } from './compose-routes.util';

export const WASHING_DRESSING_CARE_PLAN_FORM_NAME = 'Washing and dressing';

/** IA §1.6 staff-gender-preference SELECT codes → clinician-facing label. */
const STAFF_GENDER_PREFERENCE_LABELS: Record<string, string> = {
  male: 'Male',
  female: 'Female',
  no_preference: 'No preference',
  case_by_case: 'Case by case',
};

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

function resolveGenderOfCarerPreferred(ctx: CarePlanComposeContext): ComposeFieldResult | null {
  // The current preference (DOM Care) wins over the assessment answer it started from.
  const current = ctx.profile?.staffGenderPreference?.toLowerCase().trim();
  if (current && STAFF_GENDER_PREFERENCE_LABELS[current]) {
    return {
      fieldKey: '',
      label: 'Gender of carer preferred',
      value: STAFF_GENDER_PREFERENCE_LABELS[current],
      source: 'profile',
      sourceLabel: 'DOM Care: gender preference of staff',
    };
  }
  if (!ctx.ia) return null;

  const answer =
    findIaAnswer(ctx.ia.answers, { specRef: '1.6', questionTextContains: 'gender preference' }) ??
    findIaAnswer(ctx.ia.answers, {
      questionTextContains: 'Staff gender preference for personal care',
    });
  if (!answer) return null;

  const raw = resolveIaRawValue(answer)?.toLowerCase().trim() ?? null;
  const mapped = raw ? STAFF_GENDER_PREFERENCE_LABELS[raw] : null;
  const value = sanitizeComposeTextOrNull(mapped ?? resolveIaDisplayValue(answer));
  if (!value) return null;

  return {
    fieldKey: '',
    label: 'Gender of carer preferred',
    value,
    source: 'ia',
    sourceLabel: 'IA §1.6 Staff gender preference for personal care',
  };
}

export const WASHING_DRESSING_CARE_PLAN_FIELD_MAPPINGS: LabelFieldMapping[] = [
  {
    fieldLabel: 'Gender of carer preferred',
    resolve: resolveGenderOfCarerPreferred,
  },
];

export function composeWashingDressingCarePlan(
  ctx: CarePlanComposeContext,
  fields: CarePlanFormFieldRef[],
  serviceUserId: string,
): ComposePlanResult {
  return composeLabelMappedForm(ctx, fields, WASHING_DRESSING_CARE_PLAN_FIELD_MAPPINGS, {
    serviceUserId,
    initialEvidence: baseEvidence(ctx, serviceUserId),
    composedFrom: {
      formName: WASHING_DRESSING_CARE_PLAN_FORM_NAME,
      iaSubmissionId: ctx.ia?.submissionId ?? null,
      composedAt: new Date().toISOString(),
    },
    fixesForField: () => [
      { label: 'Complete about-me / personal-care preferences', route: iaRoute(serviceUserId, 1) },
    ],
  });
}
