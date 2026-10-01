import { PERSON_CENTRED_CARE_PLAN_SEED } from '../../../prisma/seeds/person-centred-care-plan.seed-data';
import {
  PERSON_CENTRED_FIELD_REGISTRY,
  PERSON_CENTRED_AUTO_PREFILL_KEYS,
  PERSON_CENTRED_MANUAL_KEYS,
  PERSON_CENTRED_SUGGESTION_KEYS,
  personCentredFieldRegistryEntry,
  assertPersonCentredRegistryMatchesTemplate,
} from './person-centred-care-plan-field-registry';
import { runCarePlanCompose } from './compose-context.loader';
import type { CarePlanComposeContext, CarePlanFormFieldRef } from './compose-context.types';

const PERSON_CENTRED_FORM_NAME = 'Person Centred care plan';

/** Field refs as the loader builds them from the (unchanged) 6-field / 2-section schema. */
function fieldRefsFromSeed(): CarePlanFormFieldRef[] {
  const refs: CarePlanFormFieldRef[] = [];
  PERSON_CENTRED_CARE_PLAN_SEED.sections.forEach((section, si) => {
    section.fields.forEach((field, fi) => {
      refs.push({
        key: `sec-${si}:f-${si}-${fi}`,
        sectionId: `sec-${si}`,
        fieldId: `f-${si}-${fi}`,
        fieldKey: field.fieldKey,
        label: field.label,
        fieldType: field.fieldType,
        required: field.required ?? false,
        sectionTitle: section.title,
      } as CarePlanFormFieldRef);
    });
  });
  return refs;
}

function keyOf(fieldKey: string): string {
  return fieldRefsFromSeed().find((f) => f.fieldKey === fieldKey)!.key;
}

function ctxWith(): CarePlanComposeContext {
  return {
    serviceUserId: 'su-1',
    serviceUserName: 'Margaret Hughes',
    personalisation: {},
    emergencyContacts: [],
    allergies: [],
    aboutMe: {
      whatMattersMost: 'Seeing my grandchildren',
      howToSupport: 'Give me time and reassurance',
      peopleImportant: 'My daughter Jane',
      routineSummary: 'Tea and radio in the morning',
      nightSupport: 'Nightlight and a warm drink',
      triggersCalm: 'Loud noise upsets me; music calms me',
    },
    ia: { submissionId: 'ia-1', submittedAt: '2026-06-01T10:00:00.000Z', answers: [] },
    emar: { activeCount: 0, scheduledCount: 0, prnCount: 0, medListText: '', prnText: '' },
    pack: null,
    gpPharmacyLine: null,
  } as unknown as CarePlanComposeContext;
}

describe('Person Centred engine still auto-prefills after key adoption (no new engine)', () => {
  it('populates all six fields into values{} by label', () => {
    const result = runCarePlanCompose(PERSON_CENTRED_FORM_NAME, ctxWith(), fieldRefsFromSeed());
    expect(result.values[keyOf('person_centred_what_important')]).toContain('grandchildren');
    expect(result.values[keyOf('person_centred_how_supported')]).toContain('reassurance');
    expect(result.values[keyOf('person_centred_people_matter')]).toContain('Jane');
    expect(result.values[keyOf('person_centred_morning_routine')]).toContain('radio');
    expect(result.values[keyOf('person_centred_evening_routine')]).toContain('Nightlight');
    expect(result.values[keyOf('person_centred_upset_calm')]).toContain('music');
  });

  it('keeps writing into values{} (AUTO_PREFILL) and does not convert to suggestions', () => {
    const result = runCarePlanCompose(PERSON_CENTRED_FORM_NAME, ctxWith(), fieldRefsFromSeed());
    expect(Object.keys(result.values).length).toBe(6);
    expect(result.suggestions).toBeUndefined();
  });

  it('routes to the existing Person Centred engine (composedFrom.formName), not a new one', () => {
    const result = runCarePlanCompose(PERSON_CENTRED_FORM_NAME, ctxWith(), fieldRefsFromSeed());
    expect((result.composedFrom as Record<string, unknown>).formName).toBe('Person Centred care plan');
  });
});

describe('Person Centred documentation registry', () => {
  it('documents 37 fields — seventeen auto-prefill, zero suggestions, twenty manual', () => {
    expect(PERSON_CENTRED_FIELD_REGISTRY).toHaveLength(37);
    expect(PERSON_CENTRED_AUTO_PREFILL_KEYS).toHaveLength(17);
    expect(PERSON_CENTRED_SUGGESTION_KEYS).toHaveLength(0);
    expect(PERSON_CENTRED_MANUAL_KEYS).toHaveLength(20);
  });

  it('prefills demographic + summary fields read-only from profile / About Me / contacts', () => {
    const ctx = {
      serviceUserId: 'su-1',
      serviceUserName: 'Margaret Hughes',
      personalisation: { preferredName: 'Peggy' },
      emergencyContacts: ['Jane Doe · Daughter · 0161 123 4567'],
      allergies: [],
      aboutMe: {
        personalCare: 'Needs help washing and dressing',
        foodPreferences: 'Soft diet, dislikes spicy food',
        communication: 'Speaks clearly, prefers short sentences',
        meaningfulActivities: 'Bingo at the day centre on Tuesdays',
      },
      profile: {
        preferredName: 'Peggy',
        dateOfBirth: '1940-05-01',
        phone: '07000 000000',
        homeAddress: '1 High Street\nManchester\nM1 1AA',
        propertyAccessInstructions: 'Key safe: 1234',
      },
      ia: { submissionId: 'ia-1', submittedAt: '2026-06-01T10:00:00.000Z', answers: [] },
      emar: { activeCount: 0, scheduledCount: 0, prnCount: 0, medListText: '', prnText: '' },
      pack: null,
      gpPharmacyLine: null,
    } as unknown as CarePlanComposeContext;

    const result = runCarePlanCompose(PERSON_CENTRED_FORM_NAME, ctx, fieldRefsFromSeed());
    expect(result.values[keyOf('person_centred_preferred_name')]).toBe('Peggy');
    expect(result.values[keyOf('person_centred_date_of_birth')]).toBe('1940-05-01');
    expect(result.values[keyOf('person_centred_phone')]).toBe('07000 000000');
    expect(result.values[keyOf('person_centred_address')]).toContain('High Street');
    expect(result.values[keyOf('person_centred_property_access')]).toContain('Key safe');
    expect(result.values[keyOf('person_centred_personal_care')]).toContain('washing');
    expect(result.values[keyOf('person_centred_eating_drinking')]).toContain('Soft diet');
    expect(result.values[keyOf('person_centred_comm_behaviour')]).toContain('short sentences');
    expect(result.values[keyOf('person_centred_community_access')]).toContain('Bingo');
    expect(result.values[keyOf('person_centred_advocate')]).toContain('Jane Doe');
  });

  it('leaves genuinely manual fields empty (no invented data, dedicated plans stay SoT)', () => {
    const result = runCarePlanCompose(PERSON_CENTRED_FORM_NAME, ctxWith(), fieldRefsFromSeed());
    for (const key of [
      'person_centred_likes',
      'person_centred_dislikes',
      'person_centred_sexuality',
      'person_centred_religion',
      'person_centred_culture',
      'person_centred_health',
      'person_centred_mobility',
      'person_centred_diagnosis',
      'person_centred_home_access_consent',
      'person_centred_consent_gained',
    ]) {
      expect(result.values[keyOf(key)]).toBeUndefined();
    }
  });

  it('contains no generic "Person-centred details" entry (exempt form)', () => {
    expect(personCentredFieldRegistryEntry('person_centred_needs_person_centred')).toBeUndefined();
  });

  it('stays in lockstep with the seed template', () => {
    expect(() => assertPersonCentredRegistryMatchesTemplate()).not.toThrow();
  });
});
