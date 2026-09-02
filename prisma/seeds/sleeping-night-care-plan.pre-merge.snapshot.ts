import { CarePathwayFormFieldType as T } from '@prisma/client';
import type { CarePlanFormSeed } from './care-plan-forms.seed-data';

/**
 * Snapshot of the Sleeping and Night CARE_PLAN template immediately before the Care 2020 merge
 * (2026-09-01). Kept so the ID-safe upgrade is reversible: restore this object as
 * CARE_PLAN_FORM_SEEDS['Sleeping and Night'] and drop the dedicated schema applier to roll back
 * the template (existing section/field UUIDs would still need a matching reverse apply).
 *
 * Live form at snapshot: name "Sleeping and Night", generic 2-section schema, all fieldKey null,
 * composed via the generic Care Plan engine (`mapping: 'generic'`).
 */
export const SLEEPING_NIGHT_CARE_PLAN_PRE_MERGE_SNAPSHOT: CarePlanFormSeed = {
  description:
    'Night-time routine, sleep patterns, disturbances, and how to promote rest while keeping the person safe.',
  sections: [
    {
      title: 'Sleep pattern',
      fields: [
        { label: 'Usual bedtime and wake time', fieldType: T.TEXT },
        { label: 'Night-time waking or confusion', fieldType: T.TEXTAREA },
        { label: 'Daytime naps', fieldType: T.YES_NO },
      ],
    },
    {
      title: 'Night care',
      fields: [
        { label: 'Evening routine', fieldType: T.TEXTAREA, required: true },
        { label: 'Call bell / monitoring', fieldType: T.TEXT },
        { label: 'Night-time drinks or snacks', fieldType: T.TEXT },
      ],
    },
  ],
};
