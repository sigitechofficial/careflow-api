import {
  answerKey,
  formProgress,
  hasAnswer,
  mergeAnswers,
  missingRequiredFields,
  snapshotFromForm,
  type SupervisionFormField,
  type SupervisionFormSnapshot,
} from './supervision-form.util';

function field(id: string, fieldType: string, extra: Partial<SupervisionFormField> = {}): SupervisionFormField {
  return {
    id,
    fieldKey: id,
    label: id,
    fieldType,
    placeholder: null,
    helpText: null,
    required: false,
    optionsJson: null,
    validationJson: null,
    conditionalLogicJson: null,
    sortOrder: 0,
    ...extra,
  };
}

const snapshot: SupervisionFormSnapshot = {
  formId: 'form-1',
  name: 'Staff supervision',
  description: null,
  formType: 'STAFF_FORM',
  formVersionId: 'v1',
  publishedAt: null,
  sections: [
    {
      id: 's1',
      title: 'Wellbeing',
      description: null,
      sortOrder: 0,
      fields: [
        field('intro', 'SECTION_TEXT', { sortOrder: 0 }),
        field('wellbeing', 'SELECT', { required: true, sortOrder: 1 }),
        field('notes', 'SUMMERNOTE', { required: true, sortOrder: 2 }),
      ],
    },
    {
      id: 's2',
      title: 'Safeguarding',
      description: null,
      sortOrder: 1,
      fields: [
        field('concern', 'YES_NO', { required: true, sortOrder: 0 }),
        field('details', 'SUMMERNOTE', {
          required: true,
          sortOrder: 1,
          conditionalLogicJson: { showWhen: [{ sectionId: 's2', fieldId: 'concern', operator: 'is_true' }] },
        }),
        field('reminded', 'CHECKBOX', { required: true, sortOrder: 2 }),
        field('topics', 'MULTI_SELECT', { sortOrder: 3 }),
      ],
    },
  ],
};

describe('supervision-form.util', () => {
  it('keys answers the way the admin form renderer does', () => {
    expect(answerKey('s1', 'notes')).toBe('s1:notes');
  });

  it('counts a Yes/No "No" as an answer but needs a required tick box ticked', () => {
    const yesNo = field('x', 'YES_NO');
    const tick = field('y', 'CHECKBOX');
    expect(hasAnswer(yesNo, false)).toBe(true);
    expect(hasAnswer(yesNo, undefined)).toBe(false);
    expect(hasAnswer(tick, false)).toBe(false);
    expect(hasAnswer(tick, true)).toBe(true);
    expect(hasAnswer(field('z', 'SUMMERNOTE'), '<p><br></p>')).toBe(false);
    expect(hasAnswer(field('m', 'MULTI_SELECT'), 'A|B')).toBe(true);
  });

  it('lists required questions with no answer, skipping hidden ones and display text', () => {
    const missing = missingRequiredFields(snapshot, { 's1:wellbeing': 'Good', 's2:concern': false });
    expect(missing.map((m) => m.key)).toEqual(['s1:notes', 's2:reminded']);
  });

  it('asks for the details once a conditional question makes them visible', () => {
    const missing = missingRequiredFields(snapshot, {
      's1:wellbeing': 'Good',
      's1:notes': '<p>Fine</p>',
      's2:concern': true,
      's2:reminded': true,
    });
    expect(missing).toEqual([{ key: 's2:details', section: 'Safeguarding', label: 'details' }]);
  });

  it('reports progress over visible questions', () => {
    expect(formProgress(snapshot, { 's1:wellbeing': 'OK', 's2:concern': false })).toEqual({
      answered: 2,
      total: 5,
      required: 4,
      requiredAnswered: 2,
    });
  });

  it('merges a patch, clears empty answers and rejects keys not on the form', () => {
    const saved = { 's1:wellbeing': 'Good', 's1:notes': '<p>Old</p>' };
    const result = mergeAnswers(snapshot, saved, {
      's1:notes': '<p></p>',
      's2:concern': true,
      's1:wellbeing': null,
      's1:intro': 'display text takes no answer',
      'other:field': 'x',
      's2:topics': 42,
    });
    expect(result.answers).toEqual({ 's2:concern': true });
    expect(result.unknownKeys).toEqual(['s1:intro', 'other:field']);
    expect(result.invalidKeys).toEqual(['s2:topics']);
  });

  it('snapshots a Care Pathway form with section and field ids kept', () => {
    const snap = snapshotFromForm({
      id: 'f',
      name: 'Spot check',
      description: null,
      formType: 'STAFF_FORM',
      currentVersionId: 'v',
      lastPublishedAt: new Date('2026-11-01T09:00:00Z'),
      currentVersion: {
        sections: [
          {
            id: 'sec',
            title: 'Arrival',
            description: null,
            sortOrder: 0,
            fields: [
              {
                id: 'fld',
                fieldKey: 'on_time',
                label: 'On time',
                fieldType: 'YES_NO',
                placeholder: null,
                helpText: null,
                required: true,
                optionsJson: null,
                validationJson: null,
                conditionalLogicJson: [],
                sortOrder: 0,
              },
            ],
          },
        ],
      },
    });
    expect(snap.publishedAt).toBe('2026-11-01T09:00:00.000Z');
    expect(snap.sections[0]?.fields[0]).toMatchObject({ id: 'fld', fieldKey: 'on_time', conditionalLogicJson: null });
  });
});
