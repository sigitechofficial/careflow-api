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
import { sanitizeComposeTextOrNull } from './compose-html-sanitize.util';
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
  const text = sanitizeComposeTextOrNull(resolveIaDisplayValue(findIaAnswer(ctx.ia.answers, query)));
  if (!text) return null;
  return { fieldKey: '', label: '', value: text, source: 'ia', sourceLabel };
}

/** Prefill a field read-only from the ServiceUser profile system-of-record. */
function profileText(
  value: string | null | undefined,
  sourceLabel: string,
): ComposeFieldResult | null {
  const text = sanitizeComposeTextOrNull(value);
  if (!text) return null;
  return { fieldKey: '', label: '', value: text, source: 'profile', sourceLabel };
}

/** Prefill a person-centred summary from the About Me record. */
function aboutMeText(
  value: string | null | undefined,
  sourceLabel = 'About Me',
): ComposeFieldResult | null {
  const text = sanitizeComposeTextOrNull(value);
  if (!text) return null;
  return { fieldKey: '', label: '', value: text, source: 'about_me', sourceLabel };
}

function aboutMeOrIa(
  ctx: CarePlanComposeContext,
  aboutMeValue: string | null | undefined,
  iaQuery: Parameters<typeof findIaAnswer>[1],
  sourceLabel: string,
): ComposeFieldResult | null {
  const aboutMe = sanitizeComposeTextOrNull(aboutMeValue);
  if (aboutMe) {
    return { fieldKey: '', label: '', value: aboutMe, source: 'about_me', sourceLabel: 'About Me' };
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
      // IA §1.4 has one combined "Morning, meal, evening and bedtime routine" answer, already used for the
      // morning field above — reusing it here only copied the same text twice. About Me only.
      resolve: (c) => aboutMeText(c.aboutMe?.nightSupport),
    },
    {
      fieldLabel: 'Things that upset or calm me',
      // §1.4 "Known triggers (anxiety, distress, confusion)"; bare specRef 1.5 picked "Food likes and dislikes".
      resolve: (c) =>
        aboutMeOrIa(c, c.aboutMe?.triggersCalm, { specRef: '1.4', questionTextContains: 'Known triggers' }, 'IA §1.4'),
    },
    // ---- Care 2020 coverage: read-only prefill from profile / About Me (existing engine) ----
    {
      fieldLabel: 'My preferred name',
      resolve: (c) => profileText(c.profile?.preferredName ?? c.personalisation.preferredName, 'Profile'),
    },
    {
      fieldLabel: 'My date of birth',
      resolve: (c) => profileText(c.profile?.dateOfBirth, 'Profile'),
    },
    {
      fieldLabel: 'My address',
      resolve: (c) => profileText(c.profile?.homeAddress, 'Profile address'),
    },
    {
      fieldLabel: 'My phone number',
      resolve: (c) => profileText(c.profile?.phone, 'Profile'),
    },
    {
      fieldLabel: 'Access to my property',
      resolve: (c) => profileText(c.profile?.propertyAccessInstructions, 'Profile address'),
    },
    {
      fieldLabel: 'Personal care needs',
      resolve: (c) =>
        aboutMeOrIa(
          c,
          c.aboutMe?.personalCare,
          { specRef: '1.4', questionTextContains: 'Bathing / shower and dressing' },
          'IA §1.4',
        ),
    },
    {
      fieldLabel: 'Eating / drinking needs',
      resolve: (c) =>
        aboutMeOrIa(c, c.aboutMe?.foodPreferences, { specRef: '1.5', questionTextContains: 'Food likes' }, 'IA §1.5'),
    },
    {
      fieldLabel: 'My mobility needs',
      // IA ADL worksheet "Mobility aids in use or required" list (submission.metadata.adl).
      resolve: (c) => {
        const adl = c.ia?.adlMetadata;
        if (!adl || adl.mobilityAidsRequired === false) return null;
        const text = sanitizeComposeTextOrNull(adl.mobilityAidsList);
        if (!text) return null;
        return { fieldKey: '', label: '', value: `Mobility aids: ${text}`, source: 'ia', sourceLabel: 'IA mobility aids' };
      },
    },
    {
      fieldLabel: 'My communication and behaviour needs',
      resolve: (c) => aboutMeText(c.aboutMe?.communication),
    },
    {
      fieldLabel: 'How I access the community',
      resolve: (c) => aboutMeText(c.aboutMe?.meaningfulActivities),
    },
    {
      fieldLabel: 'My parent, deputy or advocate name and contact number',
      resolve: (c) => {
        const text = sanitizeComposeTextOrNull(c.emergencyContacts.join('\n'));
        if (!text) return null;
        return { fieldKey: '', label: '', value: text, source: 'contacts', sourceLabel: 'Contacts' };
      },
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

export const SKIN_INTEGRITY_CARE_PLAN_FIELD_MAPPINGS: LabelFieldMapping[] = [
  { fieldLabel: 'Skin type / common issues', resolve: () => null },
  { fieldLabel: 'Emollients or creams prescribed', resolve: () => null },
  { fieldLabel: 'Previous pressure damage', resolve: () => null },
  { fieldLabel: 'Application of creams – when and where', required: true, resolve: () => null },
  { fieldLabel: 'Signs to report immediately', required: true, resolve: () => null },
];

export function composeSkinIntegrityCarePlan(
  ctx: CarePlanComposeContext,
  fields: CarePlanFormFieldRef[],
  serviceUserId: string,
): ComposePlanResult {
  return composeLabelMappedForm(ctx, fields, SKIN_INTEGRITY_CARE_PLAN_FIELD_MAPPINGS, {
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
