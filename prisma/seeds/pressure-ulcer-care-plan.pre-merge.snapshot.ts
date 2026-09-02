import { CarePathwayFormFieldType as T } from '@prisma/client';
import type { CarePlanFormSeed } from './care-plan-forms.seed-data';

/**
 * Snapshot of the Pressure Ulcer CARE_PLAN template immediately before the Care 2020 merge
 * (2026-09-01). Kept so the ID-safe upgrade is reversible: restore this object as
 * CARE_PLAN_FORM_SEEDS['Pressure Ulcer'] and drop the dedicated schema applier to roll back
 * the template (existing section/field UUIDs would still need a matching reverse apply).
 *
 * Live form at snapshot: name "Pressure Ulcer", generic 2-section schema, all fieldKey null,
 * composed via the generic Care Plan engine (`mapping: 'generic'`).
 */
export const PRESSURE_ULCER_CARE_PLAN_PRE_MERGE_SNAPSHOT: CarePlanFormSeed = {
  description:
    'Skin integrity and pressure ulcer prevention: risk level, repositioning, equipment, and existing wounds with dressings.',
  sections: [
    {
      title: 'Risk and skin',
      fields: [
        {
          label: 'Waterlow or risk score',
          fieldType: T.SELECT,
          options: ['Low', 'At risk', 'High', 'Very high'],
        },
        { label: 'Existing pressure areas or wounds', fieldType: T.TEXTAREA },
        { label: 'Skin inspection frequency', fieldType: T.TEXT },
      ],
    },
    {
      title: 'Prevention plan',
      fields: [
        { label: 'Repositioning schedule', fieldType: T.TEXTAREA, required: true },
        { label: 'Pressure relieving equipment', fieldType: T.TEXTAREA },
        { label: 'Nutrition linked to skin healing', fieldType: T.TEXT },
      ],
    },
  ],
};
