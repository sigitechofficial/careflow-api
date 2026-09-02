import { ENTERPRISE_INITIAL_ASSESSMENT_SECTIONS } from '../../prisma/seeds/initial-assessment-enterprise.seed';
import { IA_REGISTERED_HOLISTIC_TAB_IDS } from './dto/generate-ia-section.dto';
import {
  buildAutofillAnswers,
  buildDemoProfilePatch,
  classifyDemoTextRole,
  CLINICAL_NEEDS_NARRATIVE_RE,
  collectWritableDemoQuestionIds,
  formatQaGpWidgetText,
  QA_DEMO_ADDRESS_LINE1,
  QA_DEMO_EMAIL,
  QA_DEMO_GP_NAME,
  QA_DEMO_GP_PHONE,
  QA_DEMO_GP_PRACTICE,
  QA_DEMO_MOBILE,
  QA_DEMO_PHONE,
  QA_DEMO_PO_NUMBER,
  QA_DEMO_POSTCODE,
  type AnswerInput,
  type IaAutofillLevel,
  type TemplateQuestion,
} from './ia-autofill-build.util';

function flattenCatalog(): TemplateQuestion[] {
  const out: TemplateQuestion[] = [];
  for (const section of ENTERPRISE_INITIAL_ASSESSMENT_SECTIONS) {
    for (const [i, q] of section.questions.entries()) {
      out.push({
        id: `s${section.sectionNumber}-q${i}`,
        questionText: q.questionText,
        questionType: String(q.questionType ?? 'YES_NO'),
        isRequired: q.isRequired ?? false,
        sortOrder: q.sortOrder,
        metadata: q.metadata ?? null,
        options: q.options,
        sectionNumber: section.sectionNumber,
      });
    }
  }
  return out;
}

function fillAllTabs(questions: TemplateQuestion[], level: IaAutofillLevel): Map<string, AnswerInput> {
  const requested = questions.map((q) => q.id);
  const merged = new Map<string, AnswerInput>();
  for (const tabId of IA_REGISTERED_HOLISTIC_TAB_IDS) {
    const writable = collectWritableDemoQuestionIds(tabId, questions, requested, level);
    for (const a of buildAutofillAnswers(questions, level, writable)) {
      merged.set(a.questionId, a);
    }
  }
  return merged;
}

function byQuestionText(catalog: TemplateQuestion[], text: string): TemplateQuestion {
  const q = catalog.find((row) => row.questionText === text);
  if (!q) throw new Error(`Missing catalog question: ${text}`);
  return q;
}

describe('IA demo typed-field dispatch (metadata-driven)', () => {
  const catalog = flattenCatalog();

  it('PO Number widget source is a PO value, never a clinical-needs sentence', () => {
    const po = byQuestionText(catalog, 'PO number');
    expect(classifyDemoTextRole(po)).toBe('identifier');
    const answers = fillAllTabs(catalog, 'normal');
    const widgetValue = answers.get(po.id)?.textValue ?? '';
    expect(widgetValue).toBe(QA_DEMO_PO_NUMBER);
    expect(widgetValue).toBe('PO-QA-0001');
    expect(CLINICAL_NEEDS_NARRATIVE_RE.test(widgetValue)).toBe(false);
  });

  it.each(['critical', 'normal', 'low'] as const)(
    '%s does not put clinical narrative into typed contact/identifier fields',
    (level) => {
      const answers = fillAllTabs(catalog, level);
      const cases: Array<[string, string]> = [
        ['Mental health team contact', 'contact'],
        ['Safeguarding reference number', 'reference'],
        ['Local authority ID (if funded)', 'identifier'],
        ['LPOA name', 'personName'],
        ['LPOA designation', 'professionalRole'],
        ['LPOA contact details', 'contact'],
        ['Informal carer name', 'personName'],
        ['Social worker contact', 'contact'],
        ['Care manager contact', 'contact'],
        ['Advocate contact', 'contact'],
        ['Preferred hospital', 'location'],
        ['Responsible reviewer (name or role)', 'personName'],
        ['GP practice and phone', 'contact'],
        ['Pharmacy name and phone', 'contact'],
        ['GP name', 'personName'],
        ['Height band or height (cm)', 'measurementBand'],
        ['Pain location', 'bodySite'],
        ['Manager informed date and time', 'datetimeText'],
        ['Monitoring schedule / frequency', 'schedule'],
        ['Key safe location', 'location'],
      ];

      for (const [label, role] of cases) {
        const q = byQuestionText(catalog, label);
        expect(`${label}:${classifyDemoTextRole(q)}`).toBe(`${label}:${role}`);
        const value = answers.get(q.id)?.textValue;
        if (value == null) continue;
        expect(CLINICAL_NEEDS_NARRATIVE_RE.test(value)).toBe(false);
        expect(value).not.toMatch(/low in mood recently|tearful at times/);
        expect(value).not.toMatch(/self-neglect and a recent unexplained bruise/);
      }
    },
  );

  it('GP name-only is a name; GP contact details use the widget Name:/Tel: format', () => {
    const gpName = byQuestionText(catalog, 'GP name');
    const gpContact = catalog.find((q) => q.questionText === 'GP contact details')!;
    const answers = fillAllTabs(catalog, 'normal');
    expect(answers.get(gpName.id)?.textValue).toBe(QA_DEMO_GP_NAME);
    expect(answers.get(gpName.id)?.textValue).not.toMatch(/Tel:/);
    expect(answers.get(gpContact.id)?.textValue).toBe(formatQaGpWidgetText());
    expect(answers.get(gpContact.id)?.textValue).toMatch(/^Name: /);
    expect(answers.get(gpContact.id)?.textValue).toMatch(/^Tel: /m);
  });

  it('empty profile patch populates the address/GP fields the widgets persist', () => {
    const patch = buildDemoProfilePatch();
    expect(patch.address).toEqual({
      addressLine1: QA_DEMO_ADDRESS_LINE1,
      addressLine2: expect.any(String),
      town: expect.any(String),
      county: expect.any(String),
      postcode: QA_DEMO_POSTCODE,
    });
    expect(patch.phone).toBe(QA_DEMO_PHONE);
    expect(patch.mobile).toBe(QA_DEMO_MOBILE);
    expect(patch.email).toBe(QA_DEMO_EMAIL);
    expect(patch.gp).toEqual({
      name: QA_DEMO_GP_NAME,
      phone: QA_DEMO_GP_PHONE,
      practice: QA_DEMO_GP_PRACTICE,
    });
  });

  it('occupied profile values are omitted from the patch', () => {
    const patch = buildDemoProfilePatch({
      addressLine1: '1 Real Street',
      postcode: 'LS2 9JT',
      phone: '0113 111 2222',
      gpName: 'Dr Existing',
    });
    expect(patch.address?.addressLine1).toBeUndefined();
    expect(patch.address?.postcode).toBeUndefined();
    expect(patch.phone).toBeUndefined();
    expect(patch.gp?.name).toBeUndefined();
    expect(patch.mobile).toBe(QA_DEMO_MOBILE);
    expect(patch.gp?.phone).toBe(QA_DEMO_GP_PHONE);
  });
});
