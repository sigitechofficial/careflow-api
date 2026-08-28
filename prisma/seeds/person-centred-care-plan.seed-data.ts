import { CarePathwayFormFieldType as T } from '@prisma/client';
import type { CarePlanFormSeed } from './care-plan-forms.seed-data';

/**
 * Person Centred Care Plan template — a DEDICATED person-centred plan.
 *
 * DELIBERATE DESIGN DECISION: this form is exempt from the generic Care 2020 "Person-centred
 * details" rule. That rule adds one required "Person-centred details" field to the generic
 * needs/goals/support/risk block of *area* care plans. This form has NO such block — its entire
 * purpose is person-centred content ("What is important to me" [required], "How I like to be
 * supported" [required], "People who matter to me", and daily-life routines). Those existing
 * fields ARE the person-centred details; adding a generic "Person-centred details" field would
 * be a semantically redundant duplicate. Therefore NO "Person-centred details" field, and NO
 * `person_centred_needs_person_centred` key, is created here.
 *
 * The six pre-existing fields are retained exactly (same labels, types, required flags, section
 * UUIDs and field UUIDs) and gain stable `person_centred_` keys so the ID-safe applier adopts
 * them by key rather than recreating them — this also moves the form off the destructive generic
 * applier, which would otherwise hard-delete sections on every seed and orphan this form's real
 * saved values (it holds 15 valid saved values and 22 orphaned references from prior reseeds).
 *
 * Approved 2026-08-28: FIVE genuinely-missing person-centred narrative fields are ADDED to the
 * "About me" section (My likes, My dislikes, How I interact with others, Anything I'd like you to
 * know about my family, Any pets I have) — all optional free text. These are NOT held by the
 * ServiceUser profile, contacts, consent module or any dedicated area care plan. No generic
 * "Person-centred details" field, and no needs/goals/support/risk block, is added.
 *
 * The existing AUTO-PREFILL engine (`composePersonCentredCarePlan` in `area-care-plans.compose.ts`,
 * dispatched as `PERSON_CENTRED_FORM_NAME='Person Centred care plan'`) matches these fields by
 * label and draws on About Me + IA §1.3/§1.4. It is untouched; adding keys does not affect it.
 *
 * All other care plans are separate products and are not referenced here.
 */
export const PERSON_CENTRED_CARE_PLAN_NAME = 'Person Centred care plan';

export const PERSON_CENTRED_CARE_PLAN_SEED: CarePlanFormSeed = {
  description:
    'What matters most to the person: routines, preferences, relationships, and how care should feel from their perspective.',
  sections: [
    {
      // Existing section title — reused so the original section UUID is preserved.
      title: 'About me',
      fields: [
        {
          label: 'What is important to me',
          fieldType: T.TEXTAREA,
          fieldKey: 'person_centred_what_important',
          required: true,
        },
        {
          label: 'How I like to be supported',
          fieldType: T.TEXTAREA,
          fieldKey: 'person_centred_how_supported',
          required: true,
        },
        {
          label: 'People who matter to me',
          fieldType: T.TEXTAREA,
          fieldKey: 'person_centred_people_matter',
        },
        // ---- Care 2020 person-centred narrative added 2026-08-28 (approved) ----
        // Genuinely missing person-centred content not held by the profile, contacts,
        // consent module or any dedicated area care plan. All optional free text; no
        // generic "Person-centred details" field, no needs/goals/support/risk block.
        {
          label: 'My likes',
          fieldType: T.TEXTAREA,
          fieldKey: 'person_centred_likes',
        },
        {
          label: 'My dislikes',
          fieldType: T.TEXTAREA,
          fieldKey: 'person_centred_dislikes',
        },
        {
          label: 'How I interact with others',
          fieldType: T.TEXTAREA,
          fieldKey: 'person_centred_interact_others',
        },
        {
          label: 'Anything I’d like you to know about my family',
          fieldType: T.TEXTAREA,
          fieldKey: 'person_centred_family_info',
        },
        {
          label: 'Any pets I have',
          fieldType: T.TEXTAREA,
          fieldKey: 'person_centred_pets',
        },
      ],
    },
    {
      // Existing section title — reused so the original section UUID is preserved.
      title: 'Daily life',
      fields: [
        {
          label: 'Morning routine preferences',
          fieldType: T.TEXTAREA,
          fieldKey: 'person_centred_morning_routine',
        },
        {
          label: 'Evening / bedtime routine',
          fieldType: T.TEXTAREA,
          fieldKey: 'person_centred_evening_routine',
        },
        {
          label: 'Things that upset or calm me',
          fieldType: T.TEXTAREA,
          fieldKey: 'person_centred_upset_calm',
        },
      ],
    },
    // ==== Care 2020 Person Centred Assessment coverage (approved 2026-08-28) ====
    // NEW sections. All fields optional. Demographic fields are PREFILLED read-only from the
    // ServiceUser profile system-of-record (via the existing engine + loader profile facts) —
    // not duplicated. Clinical-domain fields are person-centred SUMMARIES; the dedicated area
    // care plans (Physical Health, Mobility, Eating & Drinking, Communication, Culture/Religion)
    // and the Consent & Mental Capacity module remain the source of truth. No generic
    // "Person-centred details" field and no needs/goals/support/risk block are added.
    {
      title: 'Personal details',
      description: 'Identity and contact details (prefilled from the profile where held).',
      fields: [
        { label: 'My preferred name', fieldType: T.TEXT, fieldKey: 'person_centred_preferred_name' },
        { label: 'My date of birth', fieldType: T.DATE, fieldKey: 'person_centred_date_of_birth' },
        { label: 'My sexuality', fieldType: T.TEXT, fieldKey: 'person_centred_sexuality' },
        { label: 'My ethnic origin', fieldType: T.TEXT, fieldKey: 'person_centred_ethnic_origin' },
        { label: 'My religion', fieldType: T.TEXT, fieldKey: 'person_centred_religion' },
        { label: 'My culture', fieldType: T.TEXT, fieldKey: 'person_centred_culture' },
        { label: 'My address', fieldType: T.TEXTAREA, fieldKey: 'person_centred_address' },
        { label: 'My phone number', fieldType: T.TEXT, fieldKey: 'person_centred_phone' },
      ],
    },
    {
      title: 'Family and important people',
      fields: [
        {
          label: 'My parent, deputy or advocate name and contact number',
          fieldType: T.TEXTAREA,
          fieldKey: 'person_centred_advocate',
        },
        { label: 'My family’s first language', fieldType: T.TEXT, fieldKey: 'person_centred_family_language' },
        { label: 'My siblings', fieldType: T.TEXTAREA, fieldKey: 'person_centred_siblings' },
        {
          label: 'Professionals who work with me',
          fieldType: T.TEXTAREA,
          fieldKey: 'person_centred_professionals',
        },
      ],
    },
    {
      title: 'My community, learning and safety',
      fields: [
        { label: 'How I access the community', fieldType: T.TEXTAREA, fieldKey: 'person_centred_community_access' },
        { label: 'My road safety plan', fieldType: T.TEXTAREA, fieldKey: 'person_centred_road_safety' },
        { label: 'My educational needs', fieldType: T.TEXTAREA, fieldKey: 'person_centred_educational_needs' },
        { label: 'Access to my property', fieldType: T.TEXTAREA, fieldKey: 'person_centred_property_access' },
      ],
    },
    {
      title: 'My care and health',
      description:
        'Person-centred summaries. The dedicated area care plans remain the clinical source of truth.',
      fields: [
        { label: 'Personal care needs', fieldType: T.TEXTAREA, fieldKey: 'person_centred_personal_care' },
        { label: 'Eating / drinking needs', fieldType: T.TEXTAREA, fieldKey: 'person_centred_eating_drinking' },
        {
          label: 'My communication and behaviour needs',
          fieldType: T.TEXTAREA,
          fieldKey: 'person_centred_comm_behaviour',
        },
        { label: 'About my health', fieldType: T.TEXTAREA, fieldKey: 'person_centred_health' },
        { label: 'My mobility needs', fieldType: T.TEXTAREA, fieldKey: 'person_centred_mobility' },
        { label: 'My medical diagnosis', fieldType: T.TEXTAREA, fieldKey: 'person_centred_diagnosis' },
        { label: 'Details of my care', fieldType: T.TEXTAREA, fieldKey: 'person_centred_care_details' },
      ],
    },
    {
      title: 'Consent and completion',
      description:
        'The Consent and Mental Capacity module remains the source of truth for consent decisions.',
      fields: [
        {
          label: 'I consent for access to my home',
          fieldType: T.YES_NO,
          fieldKey: 'person_centred_home_access_consent',
        },
        { label: 'How is consent gained?', fieldType: T.TEXTAREA, fieldKey: 'person_centred_consent_gained' },
        { label: 'Date care plan completed', fieldType: T.DATE, fieldKey: 'person_centred_date_completed' },
      ],
    },
  ],
};

/**
 * One-time label backfill: the original Person Centred fields carried no `fieldKey`. Mapping
 * label → key lets the schema applier adopt the existing rows, preserving their UUIDs and the
 * real saved `sectionId:fieldId` values, instead of creating duplicates. Labels are the exact
 * seeded/live labels, lower-cased for matching. These labels are also the keys the existing
 * AUTO-PREFILL engine matches on, so they must not drift.
 */
export const PERSON_CENTRED_CARE_PLAN_LEGACY_LABEL_TO_KEY: Record<string, string> = {
  'what is important to me': 'person_centred_what_important',
  'how i like to be supported': 'person_centred_how_supported',
  'people who matter to me': 'person_centred_people_matter',
  'morning routine preferences': 'person_centred_morning_routine',
  'evening / bedtime routine': 'person_centred_evening_routine',
  'things that upset or calm me': 'person_centred_upset_calm',
};
