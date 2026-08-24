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
import { findIaAnswer, resolveIaDisplayValue } from './ia-answer-resolver.util';
import { composeFallsCarePlanSuggestions } from './falls-care-plan.suggestions';
import { iaRoute, profileRoute } from './compose-routes.util';

const PERSON_CENTRED_FORM = 'Person Centred care plan';
const SKIN_INTEGRITY_FORM = 'Skin Integrity';

function iaText(
  ctx: CarePlanComposeContext,
  query: Parameters<typeof findIaAnswer>[1],
  sourceLabel = 'Initial Assessment',
): ComposeFieldResult | null {
  if (!ctx.ia) return null;
  const text = resolveIaDisplayValue(findIaAnswer(ctx.ia.answers, query));
  if (!text) return null;
  return { fieldKey: '', label: '', value: text, source: 'ia', sourceLabel };
}

function aboutMeOrIa(
  ctx: CarePlanComposeContext,
  aboutMeValue: string | null | undefined,
  iaQuery: Parameters<typeof findIaAnswer>[1],
  sourceLabel: string,
): ComposeFieldResult | null {
  if (aboutMeValue?.trim()) {
    return { fieldKey: '', label: '', value: aboutMeValue, source: 'about_me', sourceLabel: 'About Me' };
  }
  return iaText(ctx, iaQuery, sourceLabel);
}

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

export function composePersonCentredCarePlan(
  ctx: CarePlanComposeContext,
  fields: CarePlanFormFieldRef[],
  serviceUserId: string,
): ComposePlanResult {
  const mappings: LabelFieldMapping[] = [
    {
      fieldLabel: 'What is important to me',
      required: true,
      resolve: (c) =>
        aboutMeOrIa(c, c.aboutMe?.whatMattersMost, { fieldKey: 'whatMattersMost' }, 'IA §1.3'),
    },
    {
      fieldLabel: 'How I like to be supported',
      required: true,
      resolve: (c) =>
        aboutMeOrIa(c, c.aboutMe?.howToSupport, { fieldKey: 'howToSupportMe' }, 'IA §1.3'),
    },
    {
      fieldLabel: 'People who matter to me',
      resolve: (c) =>
        aboutMeOrIa(c, c.aboutMe?.peopleImportant, { fieldKey: 'peopleImportantToMe' }, 'IA §1.3'),
    },
    {
      fieldLabel: 'Morning routine preferences',
      resolve: (c) =>
        aboutMeOrIa(
          c,
          c.aboutMe?.routineSummary,
          { specRef: '1.4', questionTextContains: 'morning' },
          'IA §1.4',
        ),
    },
    {
      fieldLabel: 'Evening / bedtime routine',
      resolve: (c) =>
        aboutMeOrIa(
          c,
          c.aboutMe?.nightSupport,
          { specRef: '1.4', questionTextContains: 'bedtime' },
          'IA §1.4',
        ),
    },
    {
      fieldLabel: 'Things that upset or calm me',
      resolve: (c) =>
        aboutMeOrIa(c, c.aboutMe?.triggersCalm, { specRef: '1.5' }, 'IA §1.5'),
    },
  ];

  return composeLabelMappedForm(ctx, fields, mappings, {
    serviceUserId,
    initialEvidence: baseEvidence(ctx, serviceUserId),
    composedFrom: {
      formName: PERSON_CENTRED_FORM,
      iaSubmissionId: ctx.ia?.submissionId ?? null,
      composedAt: new Date().toISOString(),
    },
    fixesForField: () => [{ label: 'Update About Me', route: profileRoute(serviceUserId) }],
  });
}

export function composeFallsCarePlan(
  ctx: CarePlanComposeContext,
  fields: CarePlanFormFieldRef[],
  serviceUserId: string,
): ComposePlanResult {
  return composeFallsCarePlanSuggestions(
    ctx.ia,
    ctx.previousAssessments ?? [],
    fields,
    serviceUserId,
  );
}

export function composeSkinIntegrityCarePlan(
  ctx: CarePlanComposeContext,
  fields: CarePlanFormFieldRef[],
  serviceUserId: string,
): ComposePlanResult {
  const mappings: LabelFieldMapping[] = [
    {
      fieldLabel: 'Skin type / common issues',
      resolve: (c) =>
        iaText(c, { specRef: '11.1', questionTextContains: 'skin' }) ??
        iaText(c, { questionTextContains: 'pressure ulcer risk assessment comment' }),
    },
    {
      fieldLabel: 'Emollients or creams prescribed',
      resolve: (c) => iaText(c, { questionTextContains: 'emollien' }),
    },
    {
      fieldLabel: 'Previous pressure damage',
      resolve: (c) =>
        iaText(c, { questionTextContains: 'currently has ulcers or wounds' }) ??
        iaText(c, { questionTextContains: 'pressure damage' }),
    },
    {
      fieldLabel: 'Application of creams – when and where',
      required: true,
      resolve: (c) =>
        iaText(c, { questionTextContains: 'pressure equipment details' }) ??
        iaText(c, { specRef: '11.1', questionTextContains: 'equipment' }),
    },
    {
      fieldLabel: 'Signs to report immediately',
      required: true,
      resolve: (c) =>
        iaText(c, { questionTextContains: 'skin integrity' }) ??
        iaText(c, { questionTextContains: 'wound' }),
    },
  ];

  return composeLabelMappedForm(ctx, fields, mappings, {
    serviceUserId,
    initialEvidence: baseEvidence(ctx, serviceUserId),
    composedFrom: {
      formName: SKIN_INTEGRITY_FORM,
      iaSubmissionId: ctx.ia?.submissionId ?? null,
      composedAt: new Date().toISOString(),
    },
    fixesForField: () => [{ label: 'Complete skin integrity section', route: iaRoute(serviceUserId, 11) }],
  });
}
