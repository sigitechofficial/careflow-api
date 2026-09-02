import {
  buildAdvanceCarePlanningDemoMetadata,
  buildEndOfLifeAssessmentDemoMetadata,
  buildHolisticWorksheetMetadata,
  EOL_ALL_QUESTION_IDS,
  EOL_NOTES_ONLY_QUESTION_IDS,
  EOL_TRI_QUESTION_IDS,
  EOL_YES_NO_QUESTION_IDS,
  QA_DEMO_DOB,
  QA_DEMO_NHS_NUMBER,
  type AdvanceCarePlanningDemoMetadata,
  type EndOfLifeAssessmentDemoMetadata,
  type IaAutofillLevel,
} from './ia-autofill-build.util';
import { IaApiAutofillService } from './ia-api-autofill.service';

const GENERIC_IDENTITY = {
  firstName: 'Helen',
  lastName: 'Wright',
  preferredName: 'Helen',
  dateOfBirth: '1948-03-12',
  nhsNumber: '943 476 5919',
  gender: 'Female',
  addressContact: '8 Birch Lane, York, YO1 6AB\nTel: 01904 496 100',
  gpContact: 'Dr S. Khan, Riverbank Surgery\nTel: 01904 496 200',
  emergencyContact: 'Paul Wright · Son · 07700 900321',
};

const PERSONA_NAMES = [
  'Margaret Hughes',
  'Doris Clarke',
  'James Okafor',
  'Fatima Al-Rashid',
  'Betty Henderson',
];

const ACP_ALWAYS_VISIBLE_STRING_KEYS = [
  'patientName',
  'address',
  'dateOfBirth',
  'hospitalOrNhsNumber',
  'dateCompleted',
  'gpDetails',
  'hospitalContact',
  'familyMemberName',
  'familyContactTel',
  'professionalName',
  'professionalRole',
  'professionalContactTel',
  'patientSignature',
  'patientSignatureDate',
  'nextOfKinSignature',
  'nextOfKinSignatureDate',
  'homecareProfessionalSignature',
  'homecareProfessionalSignatureDate',
  'reviewDate',
  'personalValues',
  'carePreferences',
  'concernsAndFears',
  'placeOfCareFirstChoice',
  'placeOfCareSecondChoice',
  'placeOfCareComments',
  'specialRequests',
  'thirdPartyComments',
] as const;

function prohibitedPlaceholder(text: string): boolean {
  return /\bN\/A\b|\bnot applicable\b|\bdemo\b|\btest user\b|\blorem ipsum\b|\bE2E\b/i.test(text);
}

function collectStrings(value: unknown, into: string[] = []): string[] {
  if (typeof value === 'string') {
    into.push(value);
    return into;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, into);
    return into;
  }
  if (value && typeof value === 'object') {
    for (const item of Object.values(value)) collectStrings(item, into);
  }
  return into;
}

function isAcpComplete(meta: AdvanceCarePlanningDemoMetadata): boolean {
  return (
    Boolean(meta.dateCompleted?.trim()) &&
    (meta.legalAdvanceDecision === true || meta.legalAdvanceDecision === false) &&
    Boolean(meta.personalValues?.trim()) &&
    Boolean(meta.carePreferences?.trim()) &&
    Boolean(meta.concernsAndFears?.trim())
  );
}

function isEolComplete(meta: EndOfLifeAssessmentDemoMetadata): boolean {
  const yesNoOk = EOL_YES_NO_QUESTION_IDS.every(
    (id) => meta[`${id}Answer`] === true || meta[`${id}Answer`] === false,
  );
  const triOk = EOL_TRI_QUESTION_IDS.every((id) => {
    const v = meta[`${id}TriAnswer`];
    return v === 'yes' || v === 'no' || v === 'unknown';
  });
  return yesNoOk && triOk;
}

function everyVisibleEolNotesFilled(meta: EndOfLifeAssessmentDemoMetadata): boolean {
  return EOL_ALL_QUESTION_IDS.every((id) => {
    const notes = meta[`${id}Notes`];
    return typeof notes === 'string' && notes.trim().length > 0;
  });
}

describe('generic IA QA demo — Advance Care Planning and End of Life worksheets', () => {
  it.each(['critical', 'normal', 'low'] as const)(
    '%s Advance Care Planning fills every applicable visible field',
    (level) => {
      const acp = buildAdvanceCarePlanningDemoMetadata(level, GENERIC_IDENTITY);
      for (const key of ACP_ALWAYS_VISIBLE_STRING_KEYS) {
        expect(String(acp[key] ?? '').trim().length).toBeGreaterThan(0);
      }
      expect(acp.legalAdvanceDecision === true || acp.legalAdvanceDecision === false).toBe(true);
      expect(acp.proxyContact1.name.trim()).toBeTruthy();
      expect(acp.proxyContact1.tel.trim()).toBeTruthy();
      expect(acp.proxyContact1.lpoa === true || acp.proxyContact1.lpoa === false).toBe(true);
      expect(acp.proxyContact2.name.trim()).toBeTruthy();
      expect(acp.proxyContact2.tel.trim()).toBeTruthy();
      expect(acp.proxyContact2.lpoa === true || acp.proxyContact2.lpoa === false).toBe(true);
      expect(isAcpComplete(acp)).toBe(true);
    },
  );

  it.each(['critical', 'normal', 'low'] as const)(
    '%s End of Life Assessment fills every applicable visible field',
    (level) => {
      const eol = buildEndOfLifeAssessmentDemoMetadata(level, GENERIC_IDENTITY);
      expect(isEolComplete(eol)).toBe(true);
      expect(everyVisibleEolNotesFilled(eol)).toBe(true);
      expect(EOL_ALL_QUESTION_IDS).toHaveLength(19);
    },
  );

  it('never invents an ADRT legal decision at any QA level', () => {
    for (const level of ['critical', 'normal', 'low'] as const) {
      const acp = buildAdvanceCarePlanningDemoMetadata(level, GENERIC_IDENTITY);
      expect(acp.legalAdvanceDecision).toBe(false);
      expect(acp.legalAdvanceDecisionDetails).toBeUndefined();
    }
  });

  it('scenarios differ clinically without inventing a diagnosis', () => {
    const criticalEol = buildEndOfLifeAssessmentDemoMetadata('critical', GENERIC_IDENTITY);
    const moderateEol = buildEndOfLifeAssessmentDemoMetadata('normal', GENERIC_IDENTITY);
    const stableEol = buildEndOfLifeAssessmentDemoMetadata('low', GENERIC_IDENTITY);

    expect(criticalEol.endOfLifeCarePlanAnswer).toBe(true);
    expect(moderateEol.endOfLifeCarePlanAnswer).toBe(false);
    expect(stableEol.endOfLifeCarePlanAnswer).toBe(false);

    expect(criticalEol.dnrInPlaceAnswer).toBe(false);
    expect(moderateEol.dnrInPlaceAnswer).toBe(false);
    expect(stableEol.dnrInPlaceAnswer).toBe(false);

    expect(criticalEol.medicalAidRecoveryTriAnswer).toBe('no');
    expect(moderateEol.medicalAidRecoveryTriAnswer).toBe('unknown');
    expect(stableEol.medicalAidRecoveryTriAnswer).toBe('yes');

    expect(criticalEol.capacityEndOfLifeAnswer).toBe(true);
    expect(stableEol.capacityEndOfLifeAnswer).toBe(true);

    const blob = JSON.stringify({ criticalEol, moderateEol, stableEol }).toLowerCase();
    expect(blob).not.toMatch(/dementia|cancer|alzheimer|terminal diagnosis/);
  });

  it('uses deterministic dates tied to the assessment date, not an independent today on every field', () => {
    const acp = buildAdvanceCarePlanningDemoMetadata('normal', GENERIC_IDENTITY);
    expect(acp.dateOfBirth).toBe('1948-03-12');
    expect(acp.dateCompleted).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(acp.reviewDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(acp.patientSignatureDate).toBe(acp.dateCompleted);
    expect(acp.nextOfKinSignatureDate).toBe(acp.dateCompleted);
    expect(acp.homecareProfessionalSignatureDate).toBe(acp.dateCompleted);
    expect(acp.dateOfBirth).not.toBe(acp.dateCompleted);

    const completed = Date.parse(`${acp.dateCompleted}T00:00:00.000Z`);
    const review = Date.parse(`${acp.reviewDate}T00:00:00.000Z`);
    expect(review).toBeGreaterThan(completed);
  });

  it('empty identity uses synthetic QA values; occupied identity is preserved', () => {
    const empty = buildAdvanceCarePlanningDemoMetadata('low');
    expect(empty.patientName).toBe('Helen Wright');
    expect(empty.dateOfBirth).toBe(QA_DEMO_DOB);
    expect(empty.hospitalOrNhsNumber).toBe(QA_DEMO_NHS_NUMBER);
    expect(empty.familyMemberName).toBe('Sarah Wright');

    const occupied = buildAdvanceCarePlanningDemoMetadata('low', GENERIC_IDENTITY);
    expect(occupied.patientName).toBe('Helen');
    expect(occupied.dateOfBirth).toBe('1948-03-12');
    expect(occupied.hospitalOrNhsNumber).toBe('943 476 5919');
    expect(occupied.address).toContain('Birch Lane');
    expect(occupied.gpDetails).toContain('Dr S. Khan');
    expect(occupied.familyMemberName).toBe('Paul Wright');
    expect(occupied.familyContactTel).toContain('07700 900321');
    expect(occupied.proxyContact1.name).toBe('Paul Wright');
  });

  it('structured answer types stay structured (boolean / tri-state / date), not prose', () => {
    const acp = buildAdvanceCarePlanningDemoMetadata('critical', GENERIC_IDENTITY);
    const eol = buildEndOfLifeAssessmentDemoMetadata('critical', GENERIC_IDENTITY);

    expect(typeof acp.legalAdvanceDecision).toBe('boolean');
    expect(typeof acp.proxyContact1.lpoa).toBe('boolean');
    expect(acp.dateCompleted).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(acp.reviewDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    expect(typeof eol.endOfLifeCarePlanAnswer).toBe('boolean');
    expect(eol.medicalAidRecoveryTriAnswer).toBe('no');
    expect(['yes', 'no', 'unknown']).toContain(eol.lastWillTriAnswer);
    expect(typeof eol.endOfLifeCarePlanNotes).toBe('string');
  });

  it('person-centred ACP wishes are first person; professional fields are not', () => {
    const acp = buildAdvanceCarePlanningDemoMetadata('normal', GENERIC_IDENTITY);
    expect(acp.personalValues).toMatch(/^(I |I'm )/i);
    expect(acp.carePreferences).toMatch(/^(I |I'm )/i);
    expect(acp.concernsAndFears).toMatch(/^(I |I'm )/i);
    expect(acp.specialRequests).toMatch(/^(Please |I )/i);
    expect(acp.professionalName).toBe('Sarah Thompson');
    expect(acp.professionalName).not.toMatch(/^(I |I'm )/i);
    expect(acp.homecareProfessionalSignature).toBe('Sarah Thompson');
  });

  it('does not emit Demo / Test / N/A placeholders or persona names', () => {
    for (const level of ['critical', 'normal', 'low'] as const) {
      const meta = buildHolisticWorksheetMetadata(level, GENERIC_IDENTITY);
      const blob = collectStrings({
        acp: meta.advanceCarePlanning,
        eol: meta.endOfLifeAssessment,
      }).join('\n');
      expect(prohibitedPlaceholder(blob)).toBe(false);
      for (const name of PERSONA_NAMES) {
        expect(blob).not.toContain(name);
      }
    }
  });

  it('Fill again is deterministic within the same calendar day', () => {
    const first = buildHolisticWorksheetMetadata('critical', GENERIC_IDENTITY);
    const second = buildHolisticWorksheetMetadata('critical', GENERIC_IDENTITY);
    expect(second.advanceCarePlanning).toEqual(first.advanceCarePlanning);
    expect(second.endOfLifeAssessment).toEqual(first.endOfLifeAssessment);
  });

  it('JSON persistence round-trip keeps worksheet answers (reload contract)', () => {
    const original = buildHolisticWorksheetMetadata('critical', GENERIC_IDENTITY);
    const reloaded = JSON.parse(JSON.stringify(original)) as Record<string, unknown>;
    expect(reloaded.advanceCarePlanning).toEqual(original.advanceCarePlanning);
    expect(reloaded.endOfLifeAssessment).toEqual(original.endOfLifeAssessment);
    expect(isAcpComplete(reloaded.advanceCarePlanning as AdvanceCarePlanningDemoMetadata)).toBe(true);
    expect(isEolComplete(reloaded.endOfLifeAssessment as EndOfLifeAssessmentDemoMetadata)).toBe(true);
  });

  it('notes-only EOL questions have notes and no boolean/tri keys', () => {
    const eol = buildEndOfLifeAssessmentDemoMetadata('normal', GENERIC_IDENTITY);
    for (const id of EOL_NOTES_ONLY_QUESTION_IDS) {
      expect(eol[`${id}Answer`]).toBeUndefined();
      expect(eol[`${id}TriAnswer`]).toBeUndefined();
      expect(String(eol[`${id}Notes`] ?? '').trim()).toBeTruthy();
    }
  });
});

describe('generateSection persistence boundary for ACP / EOL tabs', () => {
  function makeService() {
    const templates = {
      getDefaultTemplate: jest.fn().mockResolvedValue({ data: { sections: [] } }),
    };
    return new IaApiAutofillService(templates as never);
  }

  it.each(['critical', 'normal', 'low'] as const)(
    'tab 13 returns complete advanceCarePlanning metadata at %s and does not persist',
    async (level: IaAutofillLevel) => {
      const service = makeService();
      const res = await service.generateSection(level, 13, [], GENERIC_IDENTITY);
      expect(Object.keys(res.metadata)).toContain('advanceCarePlanning');
      expect(Object.keys(res.metadata)).not.toContain('endOfLifeAssessment');
      const acp = res.metadata.advanceCarePlanning as AdvanceCarePlanningDemoMetadata;
      expect(isAcpComplete(acp)).toBe(true);
      expect(acp.patientName).toBe('Helen');
    },
  );

  it.each(['critical', 'normal', 'low'] as const)(
    'tab 14 returns complete endOfLifeAssessment metadata at %s and does not persist',
    async (level: IaAutofillLevel) => {
      const service = makeService();
      const res = await service.generateSection(level, 14, [], GENERIC_IDENTITY);
      expect(Object.keys(res.metadata)).toContain('endOfLifeAssessment');
      expect(Object.keys(res.metadata)).not.toContain('advanceCarePlanning');
      const eol = res.metadata.endOfLifeAssessment as EndOfLifeAssessmentDemoMetadata;
      expect(isEolComplete(eol)).toBe(true);
      expect(everyVisibleEolNotesFilled(eol)).toBe(true);
    },
  );
});
