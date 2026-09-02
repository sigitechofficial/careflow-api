import { CarePathwayFormFieldType as T } from '@prisma/client';
import type { CarePlanFormSeed } from './care-plan-forms.seed-data';

/**
 * Snapshot of the Washing and dressing CARE_PLAN template immediately before the Care 2020 merge
 * (2026-09-01). Kept so the ID-safe upgrade is reversible: restore this object as
 * CARE_PLAN_FORM_SEEDS['Washing and dressing'] and drop the dedicated schema applier to roll back
 * the template (existing section/field UUIDs would still need a matching reverse apply).
 *
 * Live form at snapshot: name "Washing and dressing", generic 2-section schema, all fieldKey null,
 * composed via the generic Care Plan engine (`mapping: 'generic'`).
 */
export const WASHING_DRESSING_CARE_PLAN_PRE_MERGE_SNAPSHOT: CarePlanFormSeed = {
  description:
    'Personal care preferences for washing, bathing, oral care, and dressing including dignity, gender, and equipment.',
  sections: [
    {
      title: 'Preferences',
      fields: [
        {
          label: 'Preferred wash type',
          fieldType: T.SELECT,
          options: ['Full bath', 'Shower', 'Strip wash', 'Bed bath', 'Declines on this day'],
        },
        {
          label: 'Preferred time of day',
          fieldType: T.SELECT,
          options: ['Morning', 'Afternoon', 'Evening'],
        },
        { label: 'Gender of carer preferred', fieldType: T.TEXT },
      ],
    },
    {
      title: 'Dressing and grooming',
      fields: [
        {
          label: 'Level of assistance required',
          fieldType: T.SELECT,
          options: ['Independent', 'Supervision', 'Full assistance'],
        },
        { label: 'Clothing preferences', fieldType: T.TEXTAREA },
        { label: 'Dental / denture care', fieldType: T.TEXTAREA, required: true },
      ],
    },
  ],
};
