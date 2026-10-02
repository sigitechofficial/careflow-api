import type {
  CarePlanComposeContext,
  CarePlanFormFieldRef,
  ComposeEvidenceItem,
  ComposeGap,
  ComposePlanResult,
} from './compose-context.types';
import {
  findIaAnswer,
  mapMedicationSupportLevelToCarePlan,
  resolveIaDisplayValue,
  resolveIaRawValue,
  resolveIaBooleanYes,
} from './ia-answer-resolver.util';
import {
  composeLabelMappedForm,
  mergeEvidence,
  type LabelFieldMapping,
} from './label-mapped-compose.util';
import { iaRoute, medRoute, profileRoute } from './compose-routes.util';
import { resolveComposeNextReviewDate } from './compose-next-review-date.util';
import { iaConsentCapacitySummary } from './consent-capacity-summary.util';

function isoDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function joinParts(parts: Array<string | null | undefined>): string | null {
  const lines = parts.filter((p) => p?.trim()) as string[];
  return lines.length > 0 ? lines.join('\n') : null;
}

function joinIa(ctx: CarePlanComposeContext, queries: Array<{ fieldKey?: string; specRef?: string; contains?: string }>): string | null {
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

function deriveOverallRiskLevel(ctx: CarePlanComposeContext): string {
  if (!ctx.ia) return 'Medium';
  const flags = [
    resolveIaBooleanYes(findIaAnswer(ctx.ia.answers, { specRef: '12.1', questionTextContains: 'falls' })),
    resolveIaBooleanYes(findIaAnswer(ctx.ia.answers, { fieldKey: 'insulinAdministrationRequired' })),
    resolveIaBooleanYes(findIaAnswer(ctx.ia.answers, { specRef: '10.2', questionTextContains: 'feels depressed' })),
    resolveIaBooleanYes(findIaAnswer(ctx.ia.answers, { fieldKey: 'usesHoistOrSling' })),
  ].filter(Boolean).length;
  if (flags >= 3) return 'High';
  if (flags >= 1) return 'Medium';
  return 'Low';
}

export const MASTER_CARE_PLAN_FIELD_MAPPINGS: LabelFieldMapping[] = [
  {
    fieldLabel: 'What matters most to @',
    required: true,
    resolve: (ctx) => {
      const text = joinParts([
        ctx.aboutMe?.whatMattersMost,
        ctx.ia ? resolveIaDisplayValue(findIaAnswer(ctx.ia.answers, { fieldKey: 'whatMattersMost' })) : null,
      ]);
      if (!text) return null;
      return {
        fieldKey: '',
        label: 'What matters most to @',
        value: text,
        source: ctx.aboutMe?.whatMattersMost ? 'about_me' : 'ia',
        sourceLabel: ctx.aboutMe?.whatMattersMost ? 'About Me' : 'IA §1.3',
      };
    },
  },
  {
    fieldLabel: 'People who matter to @',
    resolve: (ctx) => {
      const text = joinParts([
        ctx.aboutMe?.peopleImportant,
        ctx.emergencyContacts.length > 0 ? ctx.emergencyContacts.join('\n') : null,
      ]);
      if (!text) return null;
      return {
        fieldKey: '',
        label: 'People who matter to @',
        value: text,
        source: ctx.aboutMe?.peopleImportant ? 'about_me' : 'contacts',
        sourceLabel: ctx.aboutMe?.peopleImportant ? 'About Me' : 'Contacts',
      };
    },
  },
  {
    fieldLabel: 'How @ likes to be supported',
    required: true,
    resolve: (ctx) => {
      const text = joinParts([ctx.aboutMe?.howToSupport]);
      if (!text) return null;
      return {
        fieldKey: '',
        label: 'How @ likes to be supported',
        value: text,
        source: 'about_me',
        sourceLabel: 'About Me',
      };
    },
  },
  {
    fieldLabel: 'Communication preferences',
    resolve: (ctx) => {
      const text = joinParts([
        ctx.aboutMe?.communication,
        joinIa(ctx, [{ specRef: '8.1', contains: 'communication support notes' }]),
      ]);
      if (!text) return null;
      return {
        fieldKey: '',
        label: 'Communication preferences',
        value: text,
        source: ctx.aboutMe?.communication ? 'about_me' : 'ia',
        sourceLabel: 'About Me / IA §8',
      };
    },
  },
  {
    fieldLabel: 'Consent and capacity summary',
    required: true,
    resolve: (ctx) => {
      const text = ctx.ia ? iaConsentCapacitySummary(ctx.ia.answers) : null;
      if (!text) return null;
      return { fieldKey: '', label: 'Consent and capacity summary', value: text, source: 'ia', sourceLabel: 'IA §2' };
    },
  },
  {
    fieldLabel: 'Primary health conditions',
    required: true,
    resolve: (ctx) => {
      const text = joinIa(ctx, [
        { fieldKey: 'generalPhysicalWellbeing' },
        { specRef: '5.1', contains: 'breathing condition details' },
        { specRef: '5.3', contains: 'pain' },
      ]);
      if (!text) return null;
      return { fieldKey: '', label: 'Primary health conditions', value: text, source: 'ia', sourceLabel: 'IA §4–§5' };
    },
  },
  {
    fieldLabel: 'GP and pharmacy contacts',
    resolve: (ctx) => {
      const text = joinParts([ctx.gpPharmacyLine]);
      if (!text) return null;
      return { fieldKey: '', label: 'GP and pharmacy contacts', value: text, source: 'ia', sourceLabel: 'IA GP contact / §13.9' };
    },
  },
  {
    fieldLabel: 'Monitoring and escalation',
    resolve: (ctx) => {
      const text = joinIa(ctx, [
        { specRef: '4.2', contains: 'vitals context' },
        { specRef: '9.5', contains: 'medication safety notes' },
      ]);
      if (!text) return null;
      return { fieldKey: '', label: 'Monitoring and escalation', value: text, source: 'ia', sourceLabel: 'IA' };
    },
  },
  {
    fieldLabel: 'Access instructions for carers',
    required: true,
    resolve: (ctx) => {
      const text = joinIa(ctx, [{ fieldKey: 'accessInstructions' }]);
      if (!text) return null;
      return { fieldKey: '', label: 'Access instructions for carers', value: text, source: 'ia', sourceLabel: 'IA §3.5' };
    },
  },
  {
    fieldLabel: 'Environmental risks',
    resolve: (ctx) => {
      const text = joinIa(ctx, [
        { fieldKey: 'petsPresent' },
        { fieldKey: 'smokingInProperty' },
        { specRef: '3.12', contains: 'car parking control measures' },
      ]);
      if (!text) return null;
      return { fieldKey: '', label: 'Environmental risks', value: text, source: 'ia', sourceLabel: 'IA §3' };
    },
  },
  {
    fieldLabel: 'Mobility and falls summary',
    required: true,
    resolve: (ctx) => {
      const text = joinIa(ctx, [
        { specRef: '12.1', contains: 'falls' },
        { specRef: '12.1', contains: 'mobility' },
      ]);
      if (!text) return null;
      return { fieldKey: '', label: 'Mobility and falls summary', value: text, source: 'ia', sourceLabel: 'IA §12' };
    },
  },
  {
    fieldLabel: 'Equipment and moving & handling',
    resolve: (ctx) => {
      const text = joinIa(ctx, [
        { fieldKey: 'usesHoistOrSling' },
        { specRef: '11.3', contains: 'pressure equipment details' },
        { specRef: '12.10', contains: 'further equipment details' },
      ]);
      if (!text) return null;
      return {
        fieldKey: '',
        label: 'Equipment and moving & handling',
        value: text,
        source: 'ia',
        sourceLabel: 'IA §11–§12',
      };
    },
  },
  {
    fieldLabel: 'Personal care preferences',
    resolve: (ctx) => {
      const text = joinParts([ctx.aboutMe?.personalCare]);
      if (!text) return null;
      return { fieldKey: '', label: 'Personal care preferences', value: text, source: 'about_me', sourceLabel: 'About Me' };
    },
  },
  {
    fieldLabel: 'Eating, drinking and nutrition',
    required: true,
    resolve: (ctx) => {
      const text = joinParts([
        ctx.aboutMe?.foodPreferences,
        joinIa(ctx, [
          { fieldKey: 'eatingAssistanceLevel' },
          { fieldKey: 'nutritionStatus' },
        ]),
      ]);
      if (!text) return null;
      return {
        fieldKey: '',
        label: 'Eating, drinking and nutrition',
        value: text,
        source: ctx.aboutMe?.foodPreferences ? 'about_me' : 'ia',
        sourceLabel: 'About Me / IA §6',
      };
    },
  },
  {
    fieldLabel: 'Cognition and mood summary',
    resolve: (ctx) => {
      const text = joinIa(ctx, [
        { fieldKey: 'emotionalWellbeing' },
        { fieldKey: 'sleepingPattern' },
        { specRef: '10.1', contains: 'mental health' },
      ]);
      if (!text) return null;
      return { fieldKey: '', label: 'Cognition and mood summary', value: text, source: 'ia', sourceLabel: 'IA §10' };
    },
  },
  {
    fieldLabel: 'Triggers and calming strategies',
    resolve: (ctx) => {
      const text = joinParts([ctx.aboutMe?.triggersCalm]);
      if (!text) return null;
      return {
        fieldKey: '',
        label: 'Triggers and calming strategies',
        value: text,
        source: 'about_me',
        sourceLabel: 'About Me',
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
      return { fieldKey: '', label: 'Medication support level', value: mapped, source: 'ia', sourceLabel: 'IA §9' };
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
    fieldLabel: 'Medication safety notes',
    resolve: (ctx) => {
      const text = joinIa(ctx, [{ specRef: '9.5', contains: 'medication safety notes' }]);
      if (!text) return null;
      return { fieldKey: '', label: 'Medication safety notes', value: text, source: 'ia', sourceLabel: 'IA §9.5' };
    },
  },
  {
    fieldLabel: 'Support goals and outcomes',
    required: true,
    resolve: (ctx) => {
      const text = joinParts([
        ctx.ia ? resolveIaDisplayValue(findIaAnswer(ctx.ia.answers, { fieldKey: 'supportGoals' })) : null,
        ctx.ia ? resolveIaDisplayValue(findIaAnswer(ctx.ia.answers, { fieldKey: 'whatMattersMost' })) : null,
      ]);
      if (!text) return null;
      return { fieldKey: '', label: 'Support goals and outcomes', value: text, source: 'ia', sourceLabel: 'IA §1.3' };
    },
  },
  {
    fieldLabel: 'Daily routines',
    resolve: (ctx) => {
      const text = joinParts([
        ctx.aboutMe?.routineSummary,
        ctx.ia ? resolveIaDisplayValue(findIaAnswer(ctx.ia.answers, { fieldKey: 'preferredVisitTimes' })) : null,
      ]);
      if (!text) return null;
      return {
        fieldKey: '',
        label: 'Daily routines',
        value: text,
        source: ctx.aboutMe?.routineSummary ? 'about_me' : 'ia',
        sourceLabel: 'About Me / IA',
      };
    },
  },
  {
    fieldLabel: 'Emergency contacts',
    required: true,
    resolve: (ctx) => {
      if (ctx.emergencyContacts.length === 0) return null;
      return {
        fieldKey: '',
        label: 'Emergency contacts',
        value: ctx.emergencyContacts.join('\n'),
        source: 'contacts',
        sourceLabel: 'Service user contacts',
      };
    },
  },
  {
    fieldLabel: 'Escalation pathway',
    required: true,
    resolve: (ctx) => {
      const text = joinIa(ctx, [
        { specRef: '13.9', contains: 'out of hours' },
        { fieldKey: 'gpContactDetails' },
      ]);
      if (!text) return null;
      return { fieldKey: '', label: 'Escalation pathway', value: text, source: 'ia', sourceLabel: 'IA GP / §13' };
    },
  },
  {
    fieldLabel: 'Assessment date',
    required: true,
    resolve: () => ({
      fieldKey: '',
      label: 'Assessment date',
      value: isoDateOnly(new Date()),
      source: 'static',
      sourceLabel: 'Today',
    }),
  },
  {
    fieldLabel: 'Overall risk level',
    resolve: (ctx) => ({
      fieldKey: '',
      label: 'Overall risk level',
      value: deriveOverallRiskLevel(ctx),
      source: 'ia',
      sourceLabel: 'IA risk flags',
    }),
  },
  {
    fieldLabel: 'Next plan review date',
    resolve: (ctx) => resolveComposeNextReviewDate(ctx, 'Next plan review date'),
  },
];

function buildMasterFixes(label: string, serviceUserId: string): ComposeGap['fixes'] {
  const ia = iaRoute(serviceUserId);
  switch (label.toLowerCase()) {
    case 'what matters most to @':
    case 'how @ likes to be supported':
      return [{ label: 'Complete About Me', route: `/service-users/${serviceUserId}/about-me` }];
    case 'emergency contacts':
      return [{ label: 'Add emergency contacts', route: profileRoute(serviceUserId) }];
    case 'active medications summary':
      return [{ label: 'Add medications in eMAR', route: medRoute(serviceUserId) }];
    default:
      return [{ label: 'Review Initial Assessment', route: ia }];
  }
}

export function composeMasterCarePlan(
  ctx: CarePlanComposeContext,
  fields: CarePlanFormFieldRef[],
  serviceUserId: string,
): ComposePlanResult {
  let evidence: ComposeEvidenceItem[] = [];

  if (ctx.aboutMe?.whatMattersMost) {
    evidence = mergeEvidence(evidence, {
      id: 'about-me',
      source: 'about_me',
      label: 'About Me',
      value: 'Person-centred profile on file',
      route: `/service-users/${serviceUserId}/about-me`,
    });
  }

  if (ctx.ia) {
    evidence = mergeEvidence(evidence, {
      id: 'ia-submission',
      source: 'ia',
      label: 'Initial Assessment',
      value: ctx.ia.submittedAt ? `Submitted ${ctx.ia.submittedAt.slice(0, 10)}` : 'On file',
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

  return composeLabelMappedForm(ctx, fields, MASTER_CARE_PLAN_FIELD_MAPPINGS, {
    serviceUserId,
    initialEvidence: evidence,
    fixesForField: buildMasterFixes,
    composedFrom: {
      iaSubmissionId: ctx.ia?.submissionId ?? null,
      hasAboutMe: Boolean(ctx.aboutMe),
      emarActiveCount: ctx.emar.activeCount,
      composedAt: new Date().toISOString(),
      mapping: 'master-care-plan',
    },
  });
}
