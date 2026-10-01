import { MEDICATION_SUPPORT_LEVEL_OPTIONS as IA_MEDICATION_SUPPORT_LEVEL_OPTIONS } from '../../../prisma/seeds/initial-assessment-enterprise-options';
import { MEDICATION_SUPPORT_LEVEL_OPTIONS as CARE_PLAN_MEDICATION_SUPPORT_LEVEL_OPTIONS } from '../../../prisma/seeds/medication-care-plan.seed-data';
import { buildCarePlanPersonalisationContext } from '../../care-plan-text/care-plan-text.util';
import { CARE_PLAN_REVIEW_FIELD_MAPPINGS } from './care-plan-review.compose';
import type { CarePlanComposeContext, CarePlanFormFieldRef } from './compose-context.types';
import {
  MEDICATION_SUPPORT_LEVEL_CARE_PLAN_LABELS,
  mapMedicationSupportLevelToCarePlan,
} from './ia-answer-resolver.util';
import type { LabelFieldMapping } from './label-mapped-compose.util';
import { MASTER_CARE_PLAN_FIELD_MAPPINGS } from './master-care-plan.compose';
import {
  composeMedicationCarePlan,
  MEDICATION_CARE_PLAN_FIELD_MAPPINGS,
} from './medication-care-plan.compose';

/**
 * Medication-safety mapping: IA §9.2 "Recommended medication support level" → Medication
 * care plan SELECT. Exact 1:1 — nothing overstated, level_2b is never 'Nurse only'.
 */
const EXPECTED: Array<[string, string]> = [
  ['level_0', 'Self-administers'],
  ['level_1a', 'Prompted'],
  ['level_1b', 'Assisted by carer'],
  ['level_2a', 'Assisted by carer'],
  ['level_2b', 'Administered by carer'],
  ['provided_by_others', 'Provided by others (family / nurse)'],
];

function ctxWithLevel(level: string): CarePlanComposeContext {
  return {
    serviceUserId: 'su-1',
    serviceUserName: 'Joan Whittaker',
    personalisation: buildCarePlanPersonalisationContext({ firstName: 'Joan', lastName: 'Whittaker' }),
    ia: {
      submissionId: 'ia-1',
      submittedAt: '2026-09-01T10:00:00.000Z',
      answers: [
        {
          questionId: 'q-med-support',
          questionText: 'Recommended medication support level',
          checked: null,
          booleanValue: null,
          textValue: null,
          selectedOptions: level,
          fieldKey: 'medicationSupportLevel',
          specRef: '9.2',
          sectionNumber: 9,
          sectionTitle: 'Medication',
          carePlanArea: 'Medication',
        },
      ],
    },
    aboutMe: null,
    emergencyContacts: [],
    allergies: [],
    emar: { activeCount: 0, scheduledCount: 0, prnCount: 0, medListText: '', prnText: '' },
    pack: null,
    gpPharmacyLine: null,
  };
}

function resolveVia(mappings: LabelFieldMapping[], level: string): unknown {
  const mapping = mappings.find((m) => m.fieldLabel === 'Medication support level');
  if (!mapping) throw new Error('Medication support level mapping missing');
  return mapping.resolve(ctxWithLevel(level))?.value ?? null;
}

describe('mapMedicationSupportLevelToCarePlan — medication safety', () => {
  it.each(EXPECTED)('maps IA %s → %s', (code, label) => {
    expect(mapMedicationSupportLevelToCarePlan(code)).toBe(label);
  });

  it('covers every IA §9.2 option code', () => {
    const codes = IA_MEDICATION_SUPPORT_LEVEL_OPTIONS.options.map((o) => o.value);
    expect(codes.sort()).toEqual(EXPECTED.map(([c]) => c).sort());
  });

  it('only ever returns a label that exists in the Medication care plan SELECT', () => {
    expect(Object.values(MEDICATION_SUPPORT_LEVEL_CARE_PLAN_LABELS).sort()).toEqual(
      [...CARE_PLAN_MEDICATION_SUPPORT_LEVEL_OPTIONS].sort(),
    );
    const inputs = [
      ...EXPECTED.map(([c]) => c),
      'independent',
      'prompting',
      'packaging',
      'supervision',
      'administration',
      'full_admin',
      'family',
      'district_nurse',
    ];
    for (const input of inputs) {
      expect(CARE_PLAN_MEDICATION_SUPPORT_LEVEL_OPTIONS).toContain(mapMedicationSupportLevelToCarePlan(input));
    }
  });

  it('keeps the original four SELECT options (saved answers stay valid) in the agreed order', () => {
    expect(CARE_PLAN_MEDICATION_SUPPORT_LEVEL_OPTIONS).toEqual([
      'Self-administers',
      'Prompted',
      'Assisted by carer',
      'Administered by carer',
      'Provided by others (family / nurse)',
      'Nurse only',
    ]);
  });

  it('maps legacy snapshot codes exactly', () => {
    expect(mapMedicationSupportLevelToCarePlan('independent')).toBe('Self-administers');
    expect(mapMedicationSupportLevelToCarePlan('prompting')).toBe('Prompted');
    expect(mapMedicationSupportLevelToCarePlan('packaging')).toBe('Assisted by carer');
    expect(mapMedicationSupportLevelToCarePlan('supervision')).toBe('Assisted by carer');
    expect(mapMedicationSupportLevelToCarePlan('administration')).toBe('Administered by carer');
    expect(mapMedicationSupportLevelToCarePlan('full_admin')).toBe('Administered by carer');
    expect(mapMedicationSupportLevelToCarePlan('family')).toBe('Provided by others (family / nurse)');
    expect(mapMedicationSupportLevelToCarePlan('district_nurse')).toBe('Nurse only');
  });

  it('returns null rather than guessing (mixed, free text, unknown, empty)', () => {
    expect(mapMedicationSupportLevelToCarePlan('mixed')).toBeNull();
    expect(mapMedicationSupportLevelToCarePlan(null)).toBeNull();
    expect(mapMedicationSupportLevelToCarePlan('   ')).toBeNull();
    expect(mapMedicationSupportLevelToCarePlan('nurse visits weekly')).toBeNull();
    expect(mapMedicationSupportLevelToCarePlan('carer helps sometimes')).toBeNull();
    expect(mapMedicationSupportLevelToCarePlan('constructor')).toBeNull();
    expect(mapMedicationSupportLevelToCarePlan('LEVEL_2B')).toBe('Administered by carer');
  });

  it('passes an existing care plan label through unchanged', () => {
    expect(mapMedicationSupportLevelToCarePlan('Nurse only')).toBe('Nurse only');
    expect(mapMedicationSupportLevelToCarePlan('self-administers')).toBe('Self-administers');
  });
});

describe('every mapping site uses the same exact translation', () => {
  it.each(EXPECTED)('Medication care plan field mapping: %s → %s', (code, label) => {
    expect(resolveVia(MEDICATION_CARE_PLAN_FIELD_MAPPINGS, code)).toBe(label);
  });

  it.each(EXPECTED)('Care Plan review form mapping: %s → %s', (code, label) => {
    expect(resolveVia(CARE_PLAN_REVIEW_FIELD_MAPPINGS, code)).toBe(label);
  });

  it.each(EXPECTED)('Master care plan mapping: %s → %s', (code, label) => {
    expect(resolveVia(MASTER_CARE_PLAN_FIELD_MAPPINGS, code)).toBe(label);
  });

  it.each(EXPECTED)('Medication compose emits a %s → %s suggestion', (code, label) => {
    const supportField: CarePlanFormFieldRef = {
      key: 'overview:support',
      sectionId: 'overview',
      fieldId: 'support',
      fieldKey: 'medication_support_level',
      label: 'Medication support level',
      fieldType: 'SELECT',
      required: true,
    };
    const result = composeMedicationCarePlan(
      ctxWithLevel(code),
      [supportField],
      MEDICATION_CARE_PLAN_FIELD_MAPPINGS,
      'su-1',
    );
    const suggestion = result.suggestions?.find((s) => s.targetFieldKey === 'overview:support');
    expect(suggestion?.suggestedValue).toBe(label);
    expect(result.values['overview:support']).toBeUndefined();
  });

  it('mixed produces no medication support level suggestion', () => {
    expect(resolveVia(MEDICATION_CARE_PLAN_FIELD_MAPPINGS, 'mixed')).toBeNull();
  });
});

describe('Carer administration responsibilities wording', () => {
  function responsibilities(level: string): unknown {
    const mapping = MEDICATION_CARE_PLAN_FIELD_MAPPINGS.find(
      (m) => m.fieldLabel === 'Carer administration responsibilities',
    );
    return mapping?.resolve(ctxWithLevel(level))?.value ?? null;
  }

  it('distinguishes assistance (2a) from administration (2b)', () => {
    expect(responsibilities('level_2a')).toMatch(/Assisting the person to take their medicines/);
    expect(responsibilities('level_2a')).not.toMatch(/Administering/);
    expect(responsibilities('level_2b')).toMatch(/Administering medicines/);
  });

  it('states carers do not administer when provided by others', () => {
    expect(responsibilities('provided_by_others')).toMatch(/carers do not administer/);
  });
});
