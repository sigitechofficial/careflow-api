/**
 * Continence, Eating & Drinking, Personal Safety, and Communication Care Plan compose.
 * Answer-row sources first; metadata snapshots (demo / worksheet) as Falls/Medication-style fallbacks.
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
import {
  findIaAnswer,
  resolveIaBooleanYes,
  resolveIaDisplayValue,
} from './ia-answer-resolver.util';
import { sanitizeComposeTextOrNull } from './compose-html-sanitize.util';
import { iaRoute, profileRoute } from './compose-routes.util';

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

function iaText(
  ctx: CarePlanComposeContext,
  query: Parameters<typeof findIaAnswer>[1],
  sourceLabel = 'Initial Assessment',
): ComposeFieldResult | null {
  if (!ctx.ia) return null;
  const text = sanitizeComposeTextOrNull(resolveIaDisplayValue(findIaAnswer(ctx.ia.answers, query)));
  if (!text) return null;
  return { fieldKey: '', label: '', value: text, source: 'ia', sourceLabel };
}

function snapshotText(
  value: string | null | undefined,
  sourceLabel: string,
): ComposeFieldResult | null {
  const text = sanitizeComposeTextOrNull(value);
  if (!text) return null;
  return { fieldKey: '', label: '', value: text, source: 'ia', sourceLabel };
}

function snapshotBoolean(
  value: boolean | null | undefined,
  sourceLabel: string,
): ComposeFieldResult | null {
  if (value == null) return null;
  return { fieldKey: '', label: '', value, source: 'ia', sourceLabel };
}

/**
 * Exact IA eating-assistance codes → Eating and Drinking SELECT labels.
 *
 * Do not use substring matching: `prompting` is not `Setup only`, and
 * `assistance` is not `Supervision`. Diet/assistance fields are no longer
 * AUTO-PREFILL (approved matrix: SUGGESTION).
 */
export function mapEatingAssistanceToCarePlan(raw: string | null): string | null {
  if (!raw) return null;
  const v = raw.toLowerCase().trim();
  if (v === 'independent') return 'Independent';
  if (v === 'setup' || v === 'setup only') return 'Setup only';
  if (v === 'supervision') return 'Supervision';
  if (v === 'full_support' || v === 'full assistance') return 'Full assistance';
  return null;
}

/**
 * Exact IA foodTexture codes → Diet type SELECT labels.
 *
 * Never map diabetes / "diabet" onto Diabetic diet. Never use `.includes()`
 * (e.g. "abnormal" must not become Normal). Diet type is no longer AUTO-PREFILL.
 */
export function mapDietTypeToCarePlan(raw: string | null): string | null {
  if (!raw) return null;
  const v = raw.toLowerCase().trim();
  if (v === 'normal') return 'Normal';
  if (v === 'soft') return 'Soft';
  if (v === 'puree' || v === 'pureed' || v === 'purée' || v === 'puréed') return 'Pureed';
  if (v === 'fortified') return 'Fortified';
  if (v === 'other') return 'Other';
  return null;
}

function mapLoneWorkerRisk(raw: string | null): string | null {
  if (!raw) return null;
  const v = raw.toLowerCase().trim();
  if (v === 'low' || v.includes('low')) return 'Low';
  if (v === 'medium' || v.includes('med')) return 'Medium';
  if (v === 'high' || v.includes('high')) return 'High';
  return sanitizeComposeTextOrNull(raw);
}

// —— Continence ——

/**
 * Continence clinical fields are SUGGESTION (fluid intake is MANUAL) on the
 * approved IA → Care Plan matrix. Phase 1 disables silent AUTO-PREFILL:
 * keyword hits (`pads`, `toileting`) and IA-code → SELECT inference
 * (`incontinence` contains `continent`) must not write values.
 */
export const CONTINENCE_CARE_PLAN_FIELD_MAPPINGS: LabelFieldMapping[] = [
  { fieldLabel: 'Bladder continence', resolve: () => null },
  { fieldLabel: 'Bowel continence', resolve: () => null },
  { fieldLabel: 'Products used (pads, commode, etc.)', resolve: () => null },
  { fieldLabel: 'Toileting/prompting routine', required: true, resolve: () => null },
  { fieldLabel: 'Fluid intake guidance', resolve: () => null },
  { fieldLabel: 'Skin care after episodes', resolve: () => null },
];

export function composeContinenceCarePlan(
  ctx: CarePlanComposeContext,
  fields: CarePlanFormFieldRef[],
  serviceUserId: string,
): ComposePlanResult {
  return composeLabelMappedForm(ctx, fields, CONTINENCE_CARE_PLAN_FIELD_MAPPINGS, {
    serviceUserId,
    initialEvidence: baseEvidence(ctx, serviceUserId),
    composedFrom: {
      formName: 'Continence',
      iaSubmissionId: ctx.ia?.submissionId ?? null,
      composedAt: new Date().toISOString(),
    },
    fixesForField: () => [{ label: 'Complete continence section', route: iaRoute(serviceUserId) }],
  });
}

// —— Eating and Drinking ——

export const EATING_DRINKING_CARE_PLAN_FIELD_MAPPINGS: LabelFieldMapping[] = [
  {
    fieldLabel: 'Diet type',
    resolve: () => null,
  },
  {
    fieldLabel: 'Fluid target per day (ml)',
    resolve: (ctx) => {
      if (!ctx.ia) return null;
      const fromAnswer =
        iaText(ctx, { questionTextContains: 'fluid target' }) ??
        iaText(ctx, { questionTextContains: 'fluid intake' });
      if (fromAnswer) return fromAnswer;
      const snap = sanitizeComposeTextOrNull(ctx.ia.eatingDrinkingSnapshot?.fluidTargetMl);
      if (!snap) return null;
      return {
        fieldKey: '',
        label: 'Fluid target per day (ml)',
        value: snap,
        source: 'ia',
        sourceLabel: 'IA eating snapshot',
      };
    },
  },
  {
    fieldLabel: 'Food allergies or intolerances',
    resolve: (ctx) => {
      const allergyLines = [...ctx.allergies];
      const iaDetails =
        sanitizeComposeTextOrNull(
          resolveIaDisplayValue(findIaAnswer(ctx.ia?.answers ?? [], { fieldKey: 'allergiesSummary' })),
        ) ??
        sanitizeComposeTextOrNull(ctx.ia?.eatingDrinkingSnapshot?.foodAllergiesIntolerances) ??
        null;
      if (iaDetails && !allergyLines.some((l) => l.includes(iaDetails))) {
        allergyLines.push(iaDetails);
      }
      if (allergyLines.length === 0) return null;
      return {
        fieldKey: '',
        label: 'Food allergies or intolerances',
        value: allergyLines.join('\n'),
        source: allergyLines.length > 0 && ctx.allergies.length > 0 ? 'allergies' : 'ia',
        sourceLabel: 'Allergies / IA',
      };
    },
  },
  {
    fieldLabel: 'Level of assistance',
    resolve: () => null,
  },
  {
    fieldLabel: 'Choking risk / SALT recommendations',
    resolve: () => null,
  },
  {
    fieldLabel: 'Preferred foods and dislikes',
    required: true,
    resolve: (ctx) => {
      if (ctx.aboutMe?.foodPreferences?.trim()) {
        const text = sanitizeComposeTextOrNull(ctx.aboutMe.foodPreferences);
        if (text) {
          return {
            fieldKey: '',
            label: 'Preferred foods and dislikes',
            value: text,
            source: 'about_me',
            sourceLabel: 'About Me',
          };
        }
      }
      return (
        iaText(ctx, { questionTextContains: 'food likes and dislikes' }) ??
        snapshotText(ctx.ia?.eatingDrinkingSnapshot?.preferredFoodsDislikes, 'IA eating snapshot')
      );
    },
  },
];

export function composeEatingDrinkingCarePlan(
  ctx: CarePlanComposeContext,
  fields: CarePlanFormFieldRef[],
  serviceUserId: string,
): ComposePlanResult {
  return composeLabelMappedForm(ctx, fields, EATING_DRINKING_CARE_PLAN_FIELD_MAPPINGS, {
    serviceUserId,
    initialEvidence: baseEvidence(ctx, serviceUserId),
    composedFrom: {
      formName: 'Eating and Drinking',
      iaSubmissionId: ctx.ia?.submissionId ?? null,
      composedAt: new Date().toISOString(),
    },
    fixesForField: () => [{ label: 'Complete nutrition section', route: iaRoute(serviceUserId) }],
  });
}

// —— Personal Safety ——

export const PERSONAL_SAFETY_CARE_PLAN_FIELD_MAPPINGS: LabelFieldMapping[] = [
  {
    fieldLabel: 'Home hazards identified',
    resolve: (ctx) =>
      iaText(ctx, { fieldKey: 'staffVisitRisks' }) ??
      iaText(ctx, { fieldKey: 'homeEnvironmentSafetyMeasures' }) ??
      iaText(ctx, { questionTextContains: 'environment / access hazard' }) ??
      snapshotText(ctx.ia?.personalSafetySnapshot?.homeHazards, 'IA personal safety snapshot'),
  },
  {
    fieldLabel: 'Smoking / fire safety',
    resolve: (ctx) =>
      iaText(ctx, { fieldKey: 'fireSafetyRisksDetails' }) ??
      snapshotText(ctx.ia?.personalSafetySnapshot?.fireSafety, 'IA personal safety snapshot'),
  },
  {
    fieldLabel: 'Lone worker risk level',
    resolve: (ctx) => {
      if (!ctx.ia) return null;
      const fromSnap = mapLoneWorkerRisk(ctx.ia.personalSafetySnapshot?.loneWorkerRisk ?? null);
      if (fromSnap) {
        return {
          fieldKey: '',
          label: 'Lone worker risk level',
          value: fromSnap,
          source: 'ia',
          sourceLabel: 'IA personal safety snapshot',
        };
      }
      return null;
    },
  },
  {
    fieldLabel: 'Safeguarding concern on file',
    resolve: (ctx) => {
      if (!ctx.ia) return null;
      const answer = findIaAnswer(ctx.ia.answers, { fieldKey: 'safeguardingConcern' });
      if (answer) {
        const yes = resolveIaBooleanYes(answer);
        return {
          fieldKey: '',
          label: 'Safeguarding concern on file',
          value: yes,
          source: 'ia',
          sourceLabel: 'IA safeguarding',
        };
      }
      return snapshotBoolean(
        ctx.ia.personalSafetySnapshot?.safeguardingOnFile,
        'IA personal safety snapshot',
      );
    },
  },
  {
    fieldLabel: 'Actions in place',
    resolve: (ctx) =>
      iaText(ctx, { questionTextContains: 'safeguarding concern details' }) ??
      iaText(ctx, { questionTextContains: 'immediate action' }) ??
      iaText(ctx, { fieldKey: 'noResponseProcedureAgreed' }) ??
      snapshotText(ctx.ia?.personalSafetySnapshot?.actionsInPlace, 'IA personal safety snapshot'),
  },
  {
    fieldLabel: 'Emergency contacts',
    required: true,
    resolve: (ctx) => {
      if (ctx.emergencyContacts.length > 0) {
        return {
          fieldKey: '',
          label: 'Emergency contacts',
          value: ctx.emergencyContacts.join('\n'),
          source: 'contacts',
          sourceLabel: 'Emergency contacts',
        };
      }
      // YES_NO “emergency contact?” answers resolve to "Yes"/"No" and must not block the
      // personalSafety.emergencyContacts snapshot (demo / worksheet hydration).
      const fromIa = iaText(ctx, { questionTextContains: 'emergency contact' });
      const iaTextValue = typeof fromIa?.value === 'string' ? fromIa.value.trim().toLowerCase() : '';
      if (fromIa && iaTextValue !== 'yes' && iaTextValue !== 'no') {
        return fromIa;
      }
      return (
        snapshotText(
          ctx.ia?.personalSafetySnapshot?.emergencyContacts,
          'IA personal safety snapshot',
        ) ?? iaText(ctx, { fieldKey: 'informalCarerName' })
      );
    },
  },
];

export function composePersonalSafetyCarePlan(
  ctx: CarePlanComposeContext,
  fields: CarePlanFormFieldRef[],
  serviceUserId: string,
): ComposePlanResult {
  return composeLabelMappedForm(ctx, fields, PERSONAL_SAFETY_CARE_PLAN_FIELD_MAPPINGS, {
    serviceUserId,
    initialEvidence: baseEvidence(ctx, serviceUserId),
    composedFrom: {
      formName: 'Personal Safety',
      iaSubmissionId: ctx.ia?.submissionId ?? null,
      composedAt: new Date().toISOString(),
    },
    fixesForField: (label) =>
      label === 'Emergency contacts'
        ? [{ label: 'Add emergency contacts', route: profileRoute(serviceUserId) }]
        : [{ label: 'Complete personal safety section', route: iaRoute(serviceUserId) }],
  });
}

// —— Communication ——

export const COMMUNICATION_CARE_PLAN_FIELD_MAPPINGS: LabelFieldMapping[] = [
  {
    fieldLabel: 'Preferred language',
    resolve: (ctx) =>
      iaText(ctx, { questionTextContains: 'preferred language' }) ??
      iaText(ctx, { questionTextContains: 'first language' }) ??
      snapshotText(ctx.ia?.communicationSnapshot?.preferredLanguage, 'IA communication snapshot'),
  },
  {
    fieldLabel: 'Hearing impairment',
    resolve: () => null,
  },
  {
    fieldLabel: 'Vision impairment',
    resolve: () => null,
  },
  {
    fieldLabel: 'Primary communication method',
    resolve: (ctx) => {
      const snap = sanitizeComposeTextOrNull(ctx.ia?.communicationSnapshot?.communicationMethod);
      if (snap) {
        return {
          fieldKey: '',
          label: 'Primary communication method',
          value: snap,
          source: 'ia',
          sourceLabel: 'IA communication snapshot',
        };
      }
      return iaText(ctx, { questionTextContains: 'communication method' });
    },
  },
  {
    fieldLabel: 'How to approach conversations',
    required: true,
    resolve: (ctx) =>
      iaText(ctx, { fieldKey: 'communicationNeeds' }) ??
      iaText(ctx, { questionTextContains: 'communication support notes' }) ??
      snapshotText(ctx.ia?.communicationSnapshot?.staffGuidance, 'IA communication snapshot'),
  },
  {
    fieldLabel: 'Uses glasses/hearing aids',
    resolve: () => null,
  },
  {
    fieldLabel: 'Consent to share information with family',
    resolve: () => null,
  },
];

export function composeCommunicationCarePlan(
  ctx: CarePlanComposeContext,
  fields: CarePlanFormFieldRef[],
  serviceUserId: string,
): ComposePlanResult {
  return composeLabelMappedForm(ctx, fields, COMMUNICATION_CARE_PLAN_FIELD_MAPPINGS, {
    serviceUserId,
    initialEvidence: baseEvidence(ctx, serviceUserId),
    composedFrom: {
      formName: 'Communication',
      iaSubmissionId: ctx.ia?.submissionId ?? null,
      composedAt: new Date().toISOString(),
    },
    fixesForField: () => [{ label: 'Complete communication section', route: iaRoute(serviceUserId) }],
  });
}
