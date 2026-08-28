import { CarePathwayFormFieldType as T } from '@prisma/client';
import type { CarePlanFormSeed } from './care-plan-forms.seed-data';

/**
 * Dementia Care Plan template — the existing project Dementia plan merged with the Care 2020
 * dementia content plus the standard Care 2020 needs / goals / support / risk block.
 *
 * The six pre-existing project fields (Understanding the person + Daily support) are retained
 * EXACTLY (label, type, required, SELECT options and order — note the en dash in "Sundowning
 * or agitation – what helps") and gain stable `dementia_` keys so the ID-safe schema applier
 * can match them by key and preserve their UUIDs. Before this change the form had no keys and
 * was aligned by the destructive generic applier.
 *
 * The Care 2020 dementia clinical content is added as a new "Dementia assessment" section using
 * the fields the project's EXISTING compose engine already defines
 * (`DEMENTIA_CARE_PLAN_FIELD_MAPPINGS` + `composeDementiaCarePlan` in
 * `dementia-care-plan.compose.ts`). Those AUTO-PREFILL mappings previously targeted fields that
 * did not exist in the live schema (dead code); adding them ACTIVATES the existing engine
 * rather than creating a second one. Field labels are kept identical to the engine mapping
 * `fieldLabel`s (plain, human-readable — no placeholder tokens) so the engine keeps matching by
 * label. Nothing about the engine's data mapping is changed. These fields cover the Care 2020 dementia
 * concepts: diagnosis, cognitive functioning / rate of progress, communication, triggers &
 * distress, strategies, daily routine, activities & cognitive stimulation, family/carer
 * involvement, and next review.
 *
 * Finally the standard Care 2020 block is added with EXACTLY ONE required "Person-centred
 * details" field (dementia_needs_person_centred). No goals/support PCD duplicates are modelled.
 *
 * All other care plans are separate products and are not referenced here.
 */
export const DEMENTIA_CARE_PLAN_NAME = 'Dementia Care plan';

export const DEMENTIA_CARE_PLAN_SEED: CarePlanFormSeed = {
  description:
    'Person-centred dementia support plan covering orientation, meaningful occupation, safety, and involvement of family or advocates, together with the person’s needs, goals and the support required to achieve them, and whether there is a risk associated with this area of care.',
  sections: [
    {
      // Existing section title — reused so the original section UUID is preserved.
      title: 'Understanding the person',
      fields: [
        {
          label: 'Life history and interests',
          fieldType: T.TEXTAREA,
          fieldKey: 'dementia_life_history',
          required: true,
        },
        {
          label: 'Stage of dementia (if known)',
          fieldType: T.TEXT,
          fieldKey: 'dementia_stage',
        },
        {
          label: 'Best time of day for activities',
          fieldType: T.TEXT,
          fieldKey: 'dementia_best_time',
        },
      ],
    },
    {
      // Existing section title — reused so the original section UUID is preserved.
      title: 'Daily support',
      fields: [
        {
          label: 'Orientation cues used (signs, photos, clocks)',
          fieldType: T.TEXTAREA,
          fieldKey: 'dementia_orientation_cues',
        },
        {
          // Note the en dash "–" — matched exactly by the legacy adoption map and by the engine.
          label: 'Sundowning or agitation – what helps',
          fieldType: T.TEXTAREA,
          fieldKey: 'dementia_sundowning',
        },
        {
          label: 'Safe walking / supervision level',
          fieldType: T.SELECT,
          options: ['Independent', 'Intermittent supervision', 'Constant supervision'],
          fieldKey: 'dementia_supervision_level',
        },
      ],
    },
    {
      // Care 2020 dementia assessment — NEW section. Every field here is AUTO-PREFILLED by the
      // EXISTING engine (`DEMENTIA_CARE_PLAN_FIELD_MAPPINGS`); labels match the engine verbatim.
      title: 'Dementia assessment',
      description:
        'Assessment of the person’s dementia diagnosis, cognition, communication, triggers, routines, activities and family involvement to support person-centred care planning. Information is drawn from About Me and the Initial Assessment.',
      fields: [
        {
          label: 'What makes a good day for the person?',
          fieldType: T.TEXTAREA,
          fieldKey: 'dementia_good_day',
        },
        {
          label: 'How does the person communicate best?',
          fieldType: T.TEXTAREA,
          fieldKey: 'dementia_communication',
        },
        {
          label: 'Cognitive impairment level',
          fieldType: T.TEXT,
          fieldKey: 'dementia_cognitive_impairment',
        },
        {
          label: 'Diagnosed dementia',
          fieldType: T.YES_NO,
          fieldKey: 'dementia_diagnosed',
        },
        {
          label: 'Memory and orientation summary',
          fieldType: T.TEXTAREA,
          fieldKey: 'dementia_memory_orientation',
        },
        {
          label: 'GP cognition referral status',
          fieldType: T.TEXTAREA,
          fieldKey: 'dementia_gp_referral',
        },
        {
          label: 'Known triggers',
          fieldType: T.TEXTAREA,
          fieldKey: 'dementia_triggers',
        },
        {
          label: 'Calming strategies that work',
          fieldType: T.TEXTAREA,
          fieldKey: 'dementia_calming_strategies',
        },
        {
          label: 'Daily routines',
          fieldType: T.TEXTAREA,
          fieldKey: 'dementia_daily_routines',
        },
        {
          label: 'Meaningful activities and occupation',
          fieldType: T.TEXTAREA,
          fieldKey: 'dementia_meaningful_activities',
        },
        {
          label: 'Wandering or exit-seeking risk',
          fieldType: T.TEXTAREA,
          fieldKey: 'dementia_wandering_risk',
        },
        {
          label: 'Night-time support',
          fieldType: T.TEXTAREA,
          fieldKey: 'dementia_night_support',
        },
        {
          label: 'Family and advocate involvement',
          fieldType: T.TEXTAREA,
          fieldKey: 'dementia_family_involvement',
        },
        {
          label: 'Next dementia care plan review',
          fieldType: T.DATE,
          fieldKey: 'dementia_next_review',
        },
      ],
    },
    {
      // Care 2020 — generic needs / goals / support / risk block, added new. All MANUAL.
      // Exactly ONE "Person-centred details" field (dementia_needs_person_centred), REQUIRED.
      title: 'Needs, goals, support and risk',
      description:
        'What the person needs in this area of care, what they want it to achieve, the support required, and whether a risk is associated with this area.',
      fields: [
        {
          label: 'What are the service user needs?',
          fieldType: T.TEXTAREA,
          fieldKey: 'dementia_service_user_needs',
        },
        {
          label: 'Person-centred details',
          fieldType: T.TEXTAREA,
          fieldKey: 'dementia_needs_person_centred',
          required: true,
        },
        {
          label: 'What are the service user desired goals/outcomes?',
          fieldType: T.TEXTAREA,
          fieldKey: 'dementia_desired_goals_outcomes',
        },
        {
          label: 'Support required to achieve the desired goals/outcomes?',
          fieldType: T.TEXTAREA,
          fieldKey: 'dementia_support_required',
        },
        {
          label: 'Is there a risk associated with this area of care?',
          fieldType: T.YES_NO,
          fieldKey: 'dementia_area_risk',
        },
      ],
    },
  ],
};

/**
 * One-time label backfill: the original Dementia fields carried no `fieldKey`. Mapping label →
 * key lets the schema applier adopt the existing rows, preserving their UUIDs and any saved
 * `sectionId:fieldId` values, instead of creating duplicates. Labels are the exact seeded/live
 * labels, lower-cased for matching (note the en dash in the sundowning field). These labels are
 * also the keys the existing engine matches on, so they must not drift.
 */
export const DEMENTIA_CARE_PLAN_LEGACY_LABEL_TO_KEY: Record<string, string> = {
  'life history and interests': 'dementia_life_history',
  'stage of dementia (if known)': 'dementia_stage',
  'best time of day for activities': 'dementia_best_time',
  'orientation cues used (signs, photos, clocks)': 'dementia_orientation_cues',
  'sundowning or agitation – what helps': 'dementia_sundowning',
  'safe walking / supervision level': 'dementia_supervision_level',
};
