import type {
  CarePlanComposeContext,
  CarePlanFormFieldRef,
  ComposeEvidenceItem,
  ComposeGap,
  ComposePlanResult,
} from './compose-context.types';
import {
  findIaAnswer,
  resolveIaDisplayValue,
  resolveIaRawValue,
  resolveIaBooleanYes,
} from './ia-answer-resolver.util';
import {
  composeLabelMappedForm,
  mergeEvidence,
  type LabelFieldMapping,
} from './label-mapped-compose.util';
import { iaRoute, profileRoute } from './compose-routes.util';
import { getCarePlanReviewSchedule, computeNextReviewDueAt } from '../care-plan-review-schedule';

const DEMENTIA_CARE_PLAN_FORM_NAME = 'Dementia Care plan';

function isoDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function joinParts(parts: Array<string | null | undefined>): string | null {
  const lines = parts.filter((p) => p?.trim()) as string[];
  return lines.length > 0 ? lines.join('\n') : null;
}

function joinIa(
  ctx: CarePlanComposeContext,
  queries: Array<{ fieldKey?: string; specRef?: string; contains?: string }>,
): string | null {
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

function mapCognitiveImpairmentLabel(raw: string | null | undefined): string | null {
  if (!raw?.trim()) return null;
  const key = raw.trim().toLowerCase();
  const labels: Record<string, string> = {
    none: 'No concern / need identified',
    mild: 'Mild cognitive impairment',
    moderate: 'Moderate cognitive impairment',
    severe: 'Severe cognitive impairment',
  };
  return labels[key] ?? raw.trim();
}

function mapSupervisionLevel(ctx: CarePlanComposeContext): string | null {
  if (!ctx.ia) return null;
  const raw = resolveIaRawValue(findIaAnswer(ctx.ia.answers, { fieldKey: 'cognitiveImpairment' }));
  const key = raw?.trim().toLowerCase();
  if (key === 'severe') return 'Constant supervision';
  if (key === 'moderate') return 'Intermittent supervision';
  if (key === 'mild' || key === 'none') return 'Independent';
  const deOrientated = resolveIaBooleanYes(
    findIaAnswer(ctx.ia.answers, { specRef: '10.6a', questionTextContains: 'De-orientated' }),
  );
  if (deOrientated) return 'Intermittent supervision';
  return null;
}

function buildGpCognitionReferralSummary(ctx: CarePlanComposeContext): string | null {
  if (!ctx.ia) return null;
  const requested = resolveIaDisplayValue(
    findIaAnswer(ctx.ia.answers, { fieldKey: 'cognitionGpReferralRequested' }),
  );
  const made = resolveIaDisplayValue(
    findIaAnswer(ctx.ia.answers, { specRef: '10.6', questionTextContains: 'GP referral for cognition made' }),
  );
  const date = resolveIaDisplayValue(
    findIaAnswer(ctx.ia.answers, { specRef: '10.6', questionTextContains: 'GP referral for cognition date' }),
  );
  const parts = [
    requested ? `Referral requested: ${requested}` : null,
    made ? `Referral made: ${made}` : null,
    date ? `Referral date: ${date}` : null,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join('\n') : null;
}

export const DEMENTIA_CARE_PLAN_FIELD_MAPPINGS: LabelFieldMapping[] = [
  {
    fieldLabel: 'Life history and interests',
    required: true,
    resolve: (ctx) => {
      const text = joinParts([ctx.aboutMe?.lifeHistoryInterests, ctx.aboutMe?.whatMattersMost]);
      if (!text) return null;
      return {
        fieldKey: '',
        label: 'Life history and interests',
        value: text,
        source: 'about_me',
        sourceLabel: 'About Me',
      };
    },
  },
  {
    fieldLabel: 'What makes a good day for @',
    required: true,
    resolve: (ctx) => {
      const text = joinParts([ctx.aboutMe?.goodDay, ctx.aboutMe?.meaningfulActivities]);
      if (!text) return null;
      return {
        fieldKey: '',
        label: 'What makes a good day for @',
        value: text,
        source: 'about_me',
        sourceLabel: 'About Me',
      };
    },
  },
  {
    fieldLabel: 'How @ communicates best',
    resolve: (ctx) => {
      const text = joinParts([
        ctx.aboutMe?.communication,
        joinIa(ctx, [{ specRef: '8.1', contains: 'communication support notes' }]),
      ]);
      if (!text) return null;
      return {
        fieldKey: '',
        label: 'How @ communicates best',
        value: text,
        source: ctx.aboutMe?.communication ? 'about_me' : 'ia',
        sourceLabel: ctx.aboutMe?.communication ? 'About Me' : 'IA §8',
      };
    },
  },
  {
    fieldLabel: 'Cognitive impairment level',
    required: true,
    resolve: (ctx) => {
      if (!ctx.ia) return null;
      const raw = resolveIaRawValue(findIaAnswer(ctx.ia.answers, { fieldKey: 'cognitiveImpairment' }));
      const mapped = mapCognitiveImpairmentLabel(raw);
      if (!mapped) return null;
      return {
        fieldKey: '',
        label: 'Cognitive impairment level',
        value: mapped,
        source: 'ia',
        sourceLabel: 'IA §10.6',
      };
    },
  },
  {
    fieldLabel: 'Diagnosed dementia',
    resolve: (ctx) => {
      if (!ctx.ia) return null;
      const yes = resolveIaBooleanYes(
        findIaAnswer(ctx.ia.answers, { specRef: '10.6a', questionTextContains: 'Diagnosed dementia' }),
      );
      const display = resolveIaDisplayValue(
        findIaAnswer(ctx.ia.answers, { specRef: '10.6a', questionTextContains: 'Diagnosed dementia' }),
      );
      if (display == null && !yes) return null;
      return {
        fieldKey: '',
        label: 'Diagnosed dementia',
        value: yes,
        source: 'ia',
        sourceLabel: 'IA §10.6a',
      };
    },
  },
  {
    fieldLabel: 'Memory and orientation summary',
    resolve: (ctx) => {
      const text = joinIa(ctx, [
        { specRef: '10.6a', contains: 'Good long-term memory recall' },
        { specRef: '10.6a', contains: 'Good short-term memory recall' },
        { specRef: '10.6a', contains: 'Fully orientated' },
        { specRef: '10.6a', contains: 'De-orientated' },
        { specRef: '10.6a', contains: 'Able to follow basic instructions' },
      ]);
      if (!text) return null;
      return {
        fieldKey: '',
        label: 'Memory and orientation summary',
        value: text,
        source: 'ia',
        sourceLabel: 'IA §10.6a',
      };
    },
  },
  {
    fieldLabel: 'GP cognition referral status',
    resolve: (ctx) => {
      const text = buildGpCognitionReferralSummary(ctx);
      if (!text) return null;
      return {
        fieldKey: '',
        label: 'GP cognition referral status',
        value: text,
        source: 'ia',
        sourceLabel: 'IA §10.6',
      };
    },
  },
  {
    fieldLabel: 'Known triggers',
    resolve: (ctx) => {
      const text = joinParts([
        ctx.aboutMe?.triggersCalm,
        joinIa(ctx, [
          { specRef: '10.6a', contains: 'Gets agitated with change' },
          { specRef: '10.6a', contains: 'Challenging behaviour or agitation with change' },
        ]),
      ]);
      if (!text) return null;
      return {
        fieldKey: '',
        label: 'Known triggers',
        value: text,
        source: ctx.aboutMe?.triggersCalm ? 'about_me' : 'ia',
        sourceLabel: ctx.aboutMe?.triggersCalm ? 'About Me' : 'IA §10.6a',
      };
    },
  },
  {
    fieldLabel: 'Calming strategies that work',
    required: true,
    resolve: (ctx) => {
      const text = joinParts([ctx.aboutMe?.howToSupport, ctx.aboutMe?.triggersCalm]);
      if (!text) return null;
      return {
        fieldKey: '',
        label: 'Calming strategies that work',
        value: text,
        source: 'about_me',
        sourceLabel: 'About Me',
      };
    },
  },
  {
    fieldLabel: 'Sundowning or agitation – what helps',
    resolve: (ctx) => {
      const text = joinParts([
        ctx.aboutMe?.howToSupport,
        joinIa(ctx, [{ specRef: '10.6a', contains: 'Challenging behaviour or agitation with change' }]),
      ]);
      if (!text) return null;
      return {
        fieldKey: '',
        label: 'Sundowning or agitation – what helps',
        value: text,
        source: 'about_me',
        sourceLabel: 'About Me / IA §10.6a',
      };
    },
  },
  {
    fieldLabel: 'Daily routines',
    resolve: (ctx) => {
      const text = joinParts([ctx.aboutMe?.routineSummary]);
      if (!text) return null;
      return {
        fieldKey: '',
        label: 'Daily routines',
        value: text,
        source: 'about_me',
        sourceLabel: 'About Me routine',
      };
    },
  },
  {
    fieldLabel: 'Meaningful activities and occupation',
    required: true,
    resolve: (ctx) => {
      const text = joinParts([ctx.aboutMe?.meaningfulActivities, ctx.aboutMe?.lifeHistoryInterests]);
      if (!text) return null;
      return {
        fieldKey: '',
        label: 'Meaningful activities and occupation',
        value: text,
        source: 'about_me',
        sourceLabel: 'About Me',
      };
    },
  },
  {
    fieldLabel: 'Safe walking / supervision level',
    required: true,
    resolve: (ctx) => {
      const level = mapSupervisionLevel(ctx);
      if (!level) return null;
      return {
        fieldKey: '',
        label: 'Safe walking / supervision level',
        value: level,
        source: 'ia',
        sourceLabel: 'IA §10.6 cognitive profile',
      };
    },
  },
  {
    fieldLabel: 'Wandering or exit-seeking risk',
    resolve: (ctx) => {
      const text = joinIa(ctx, [
        { specRef: '10.6a', contains: 'De-orientated' },
        { specRef: '12.1', contains: 'Falls' },
      ]);
      if (!text) return null;
      return {
        fieldKey: '',
        label: 'Wandering or exit-seeking risk',
        value: text,
        source: 'ia',
        sourceLabel: 'IA §10.6a / §12',
      };
    },
  },
  {
    fieldLabel: 'Night-time support',
    resolve: (ctx) => {
      const text = joinParts([ctx.aboutMe?.nightSupport]);
      if (!text) return null;
      return {
        fieldKey: '',
        label: 'Night-time support',
        value: text,
        source: 'about_me',
        sourceLabel: 'About Me',
      };
    },
  },
  {
    fieldLabel: 'Family and advocate involvement',
    resolve: (ctx) => {
      const text = joinParts([
        ctx.aboutMe?.peopleImportant,
        ctx.emergencyContacts.length > 0 ? ctx.emergencyContacts.join('\n') : null,
      ]);
      if (!text) return null;
      return {
        fieldKey: '',
        label: 'Family and advocate involvement',
        value: text,
        source: ctx.aboutMe?.peopleImportant ? 'about_me' : 'contacts',
        sourceLabel: ctx.aboutMe?.peopleImportant ? 'About Me' : 'Contacts',
      };
    },
  },
  {
    fieldLabel: 'Next dementia care plan review',
    resolve: () => {
      const schedule = getCarePlanReviewSchedule(DEMENTIA_CARE_PLAN_FORM_NAME);
      return {
        fieldKey: '',
        label: 'Next dementia care plan review',
        value: isoDateOnly(computeNextReviewDueAt(new Date(), schedule.defaultIntervalDays)),
        source: 'static',
        sourceLabel: 'Six-month schedule',
      };
    },
  },
];

function buildDementiaFixes(label: string, serviceUserId: string): ComposeGap['fixes'] {
  const ia = iaRoute(serviceUserId);
  const ia10 = iaRoute(serviceUserId, 10);
  const aboutMe = `/service-users/${serviceUserId}/about-me`;
  switch (label.toLowerCase()) {
    case 'life history and interests':
    case 'what makes a good day for @':
    case 'calming strategies that work':
    case 'meaningful activities and occupation':
      return [{ label: 'Complete About Me', route: aboutMe }];
    case 'cognitive impairment level':
    case 'safe walking / supervision level':
      return [{ label: 'Complete IA §10 cognition', route: ia10 }];
    case 'family and advocate involvement':
      return [
        { label: 'Complete About Me', route: aboutMe },
        { label: 'Add emergency contacts', route: profileRoute(serviceUserId) },
      ];
    default:
      return [{ label: 'Review Initial Assessment', route: ia }];
  }
}

export function composeDementiaCarePlan(
  ctx: CarePlanComposeContext,
  fields: CarePlanFormFieldRef[],
  serviceUserId: string,
): ComposePlanResult {
  let evidence: ComposeEvidenceItem[] = [];

  if (ctx.aboutMe) {
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

  return composeLabelMappedForm(ctx, fields, DEMENTIA_CARE_PLAN_FIELD_MAPPINGS, {
    serviceUserId,
    initialEvidence: evidence,
    fixesForField: buildDementiaFixes,
    composedFrom: {
      iaSubmissionId: ctx.ia?.submissionId ?? null,
      hasAboutMe: Boolean(ctx.aboutMe),
      composedAt: new Date().toISOString(),
      mapping: 'dementia-care-plan',
    },
  });
}
