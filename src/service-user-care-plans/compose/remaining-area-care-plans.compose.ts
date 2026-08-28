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
  resolveIaDisplayValue,
  resolveIaRawValue,
  resolveIaBooleanYes,
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

/** Map IA eating assistance codes → Eating and Drinking Care Plan SELECT labels. */
export function mapEatingAssistanceToCarePlan(raw: string | null): string | null {
  if (!raw) return null;
  const v = raw.toLowerCase().trim();
  if (v === 'independent' || v.includes('independ')) return 'Independent';
  if (v === 'prompting' || v.includes('prompt') || v === 'setup' || v.includes('setup')) {
    return 'Setup only';
  }
  if (v === 'supervision' || v.includes('supervis') || v === 'assistance' || v.includes('assist')) {
    return 'Supervision';
  }
  if (v === 'full_support' || v.includes('full')) return 'Full assistance';
  return sanitizeComposeTextOrNull(raw);
}

/** Map IA foodTexture / nutrition codes → Diet type SELECT labels. */
export function mapDietTypeToCarePlan(raw: string | null): string | null {
  if (!raw) return null;
  const v = raw.toLowerCase().trim();
  if (v === 'normal' || v.includes('normal')) return 'Normal';
  if (v === 'soft' || v.includes('soft')) return 'Soft';
  if (v.includes('puree') || v.includes('purée')) return 'Pureed';
  if (v.includes('diabet')) return 'Diabetic';
  if (v.includes('fortif')) return 'Fortified';
  if (v === 'other') return 'Other';
  return sanitizeComposeTextOrNull(raw);
}

function mapSensoryLevelToImpairment(raw: string | null): boolean | null {
  if (!raw) return null;
  const v = raw.toLowerCase().trim();
  if (v === 'none' || v === 'no' || v === 'normal' || v === 'good') return false;
  if (v === 'yes' || v === 'true') return true;
  return true;
}

function mapLoneWorkerRisk(raw: string | null): string | null {
  if (!raw) return null;
  const v = raw.toLowerCase().trim();
  if (v === 'low' || v.includes('low')) return 'Low';
  if (v === 'medium' || v.includes('med')) return 'Medium';
  if (v === 'high' || v.includes('high')) return 'High';
  return sanitizeComposeTextOrNull(raw);
}

function mapContinenceSelect(raw: string | null, kind: 'bladder' | 'bowel'): string | null {
  if (!raw) return null;
  const text = sanitizeComposeTextOrNull(raw);
  if (!text) return null;
  const v = text.toLowerCase();
  if (kind === 'bladder' && v.includes('catheter')) return 'Catheter';
  if (kind === 'bowel' && v.includes('stoma')) return 'Stoma';
  if (v.includes('incontinent')) return 'Incontinent – managed';
  if (v.includes('occasional') || v.includes('leakage') || v.includes('accident')) {
    return kind === 'bladder' ? 'Occasional leakage' : 'Occasional accident';
  }
  if (v.includes('continent')) return 'Continent';
  // Snapshot may already store Care Plan SELECT labels.
  if (
    text === 'Continent' ||
    text === 'Occasional leakage' ||
    text === 'Occasional accident' ||
    text === 'Incontinent – managed' ||
    text === 'Catheter' ||
    text === 'Stoma'
  ) {
    return text;
  }
  return text;
}

// —— Continence ——

export const CONTINENCE_CARE_PLAN_FIELD_MAPPINGS: LabelFieldMapping[] = [
  {
    fieldLabel: 'Bladder continence',
    resolve: (ctx) => {
      if (!ctx.ia) return null;
      const answer = findIaAnswer(ctx.ia.answers, { fieldKey: 'bladderContinenceOptions' });
      const mapped = mapContinenceSelect(
        resolveIaDisplayValue(answer) ?? ctx.ia.continenceSnapshot?.bladderStatus ?? null,
        'bladder',
      );
      if (!mapped) return null;
      return {
        fieldKey: '',
        label: 'Bladder continence',
        value: mapped,
        source: 'ia',
        sourceLabel: answer ? 'IA bladder continence' : 'IA continence snapshot',
      };
    },
  },
  {
    fieldLabel: 'Bowel continence',
    resolve: (ctx) => {
      if (!ctx.ia) return null;
      const answer = findIaAnswer(ctx.ia.answers, { fieldKey: 'bowelContinenceOptions' });
      const mapped = mapContinenceSelect(
        resolveIaDisplayValue(answer) ?? ctx.ia.continenceSnapshot?.bowelStatus ?? null,
        'bowel',
      );
      if (!mapped) return null;
      return {
        fieldKey: '',
        label: 'Bowel continence',
        value: mapped,
        source: 'ia',
        sourceLabel: answer ? 'IA bowel continence' : 'IA continence snapshot',
      };
    },
  },
  {
    fieldLabel: 'Products used (pads, commode, etc.)',
    resolve: (ctx) =>
      iaText(ctx, { questionTextContains: 'continence product' }) ??
      iaText(ctx, { questionTextContains: 'pads' }) ??
      snapshotText(ctx.ia?.continenceSnapshot?.productsUsed, 'IA continence snapshot'),
  },
  {
    fieldLabel: 'Toileting/prompting routine',
    required: true,
    resolve: (ctx) => {
      if (!ctx.ia) return null;
      const adlNotes = ctx.ia.adlMetadata?.rows?.find(
        (r) => r.id === 'toileting' || r.activity?.toLowerCase().includes('toilet'),
      )?.notes;
      return (
        iaText(ctx, { questionTextContains: 'toileting' }) ??
        snapshotText(sanitizeComposeTextOrNull(adlNotes), 'IA ADL toileting') ??
        snapshotText(ctx.ia.continenceSnapshot?.toiletingRoutine, 'IA continence snapshot')
      );
    },
  },
  {
    fieldLabel: 'Fluid intake guidance',
    resolve: (ctx) =>
      iaText(ctx, { fieldKey: 'fluidThickness' }) ??
      iaText(ctx, { fieldKey: 'adequatelyHydrated' }) ??
      snapshotText(ctx.ia?.continenceSnapshot?.fluidGuidance, 'IA continence snapshot'),
  },
  {
    fieldLabel: 'Skin care after episodes',
    resolve: (ctx) =>
      iaText(ctx, { questionTextContains: 'skin care' }) ??
      iaText(ctx, { questionTextContains: 'barrier cream' }) ??
      snapshotText(ctx.ia?.continenceSnapshot?.skinCareAfterEpisodes, 'IA continence snapshot'),
  },
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
    resolve: (ctx) => {
      if (!ctx.ia) return null;
      const answer = findIaAnswer(ctx.ia.answers, { fieldKey: 'foodTexture' });
      const mapped = mapDietTypeToCarePlan(
        resolveIaRawValue(answer) ??
          resolveIaDisplayValue(answer) ??
          ctx.ia.eatingDrinkingSnapshot?.dietType ??
          null,
      );
      if (!mapped) return null;
      return {
        fieldKey: '',
        label: 'Diet type',
        value: mapped,
        source: 'ia',
        sourceLabel: answer ? 'IA food texture' : 'IA eating snapshot',
      };
    },
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
    resolve: (ctx) => {
      if (!ctx.ia) return null;
      const answer = findIaAnswer(ctx.ia.answers, { fieldKey: 'eatingAssistanceLevel' });
      const mapped = mapEatingAssistanceToCarePlan(
        resolveIaRawValue(answer) ??
          resolveIaDisplayValue(answer) ??
          ctx.ia.eatingDrinkingSnapshot?.mealAssistanceLevel ??
          null,
      );
      if (!mapped) return null;
      return {
        fieldKey: '',
        label: 'Level of assistance',
        value: mapped,
        source: 'ia',
        sourceLabel: answer ? 'IA eating assistance' : 'IA eating snapshot',
      };
    },
  },
  {
    fieldLabel: 'Choking risk / SALT recommendations',
    resolve: (ctx) =>
      iaText(ctx, { questionTextContains: 'choking' }) ??
      iaText(ctx, { questionTextContains: 'salt' }) ??
      snapshotText(ctx.ia?.eatingDrinkingSnapshot?.chokingSaltGuidance, 'IA eating snapshot'),
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
        iaText(ctx, { questionTextContains: 'preferred foods' }) ??
        iaText(ctx, { questionTextContains: 'dietary' }) ??
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
    resolve: (ctx) => {
      if (!ctx.ia) return null;
      const answer = findIaAnswer(ctx.ia.answers, { fieldKey: 'hearingLevel' });
      if (answer) {
        const mapped = mapSensoryLevelToImpairment(resolveIaRawValue(answer) ?? resolveIaDisplayValue(answer));
        if (mapped == null) return null;
        return {
          fieldKey: '',
          label: 'Hearing impairment',
          value: mapped,
          source: 'ia',
          sourceLabel: 'IA hearing level',
        };
      }
      return snapshotBoolean(
        ctx.ia.communicationSnapshot?.hearingImpairment,
        'IA communication snapshot',
      );
    },
  },
  {
    fieldLabel: 'Vision impairment',
    resolve: (ctx) => {
      if (!ctx.ia) return null;
      const answer = findIaAnswer(ctx.ia.answers, { fieldKey: 'sightLevel' });
      if (answer) {
        const mapped = mapSensoryLevelToImpairment(resolveIaRawValue(answer) ?? resolveIaDisplayValue(answer));
        if (mapped == null) return null;
        return {
          fieldKey: '',
          label: 'Vision impairment',
          value: mapped,
          source: 'ia',
          sourceLabel: 'IA sight level',
        };
      }
      return snapshotBoolean(
        ctx.ia.communicationSnapshot?.visionImpairment,
        'IA communication snapshot',
      );
    },
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
    resolve: (ctx) =>
      iaText(ctx, { questionTextContains: 'hearing aid' }) ??
      iaText(ctx, { questionTextContains: 'glasses' }) ??
      snapshotText(ctx.ia?.communicationSnapshot?.aids, 'IA communication snapshot'),
  },
  {
    fieldLabel: 'Consent to share information with family',
    resolve: (ctx) => {
      if (!ctx.ia) return null;
      const answer =
        findIaAnswer(ctx.ia.answers, { questionTextContains: 'consent to share' }) ??
        findIaAnswer(ctx.ia.answers, { questionTextContains: 'share information' });
      if (answer) {
        return {
          fieldKey: '',
          label: 'Consent to share information with family',
          value: resolveIaBooleanYes(answer),
          source: 'ia',
          sourceLabel: 'IA consent',
        };
      }
      return snapshotBoolean(
        ctx.ia.communicationSnapshot?.consentSharing,
        'IA communication snapshot',
      );
    },
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
