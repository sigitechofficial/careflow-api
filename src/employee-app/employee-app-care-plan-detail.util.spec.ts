import { DRAFT_NEXT_REVIEW_DATE_KEY } from '../service-user-care-plans/care-plan-review-schedule';
import {
  formatCarePlanValueForCarer,
  mapPublishedCarePlanForCarer,
  type CarePlanFormSectionForCarer,
} from './employee-app-care-plan-detail.util';

const washingForm: CarePlanFormSectionForCarer[] = [
  {
    id: 'sec-pref',
    title: 'Preferences',
    description: 'How this person likes personal care.',
    sortOrder: 0,
    fields: [
      {
        id: 'wash-type',
        sectionId: 'sec-pref',
        label: 'Preferred wash type',
        fieldType: 'SELECT',
        sortOrder: 0,
      },
      {
        id: 'time-of-day',
        sectionId: 'sec-pref',
        label: 'Preferred time of day',
        fieldType: 'SELECT',
        sortOrder: 1,
      },
      {
        id: 'gender',
        sectionId: 'sec-pref',
        label: 'Gender of carer preferred',
        fieldType: 'TEXT',
        sortOrder: 2,
      },
    ],
  },
  {
    id: 'sec-needs',
    title: 'Needs, goals, support and risk',
    sortOrder: 1,
    fields: [
      {
        id: 'needs',
        sectionId: 'sec-needs',
        label: 'What are the service user needs?',
        fieldType: 'TEXTAREA',
        sortOrder: 0,
      },
      {
        id: 'goals',
        sectionId: 'sec-needs',
        label: 'What are the service user desired goals/outcomes?',
        fieldType: 'TEXTAREA',
        sortOrder: 1,
      },
      {
        id: 'support',
        sectionId: 'sec-needs',
        label: 'Support required to achieve the desired goals/outcomes?',
        fieldType: 'TEXTAREA',
        sortOrder: 2,
      },
      {
        id: 'area-risk',
        sectionId: 'sec-needs',
        label: 'Is there a risk associated with this area of care?',
        fieldType: 'YES_NO',
        sortOrder: 3,
      },
      {
        id: 'risk-identify',
        sectionId: 'sec-needs',
        label: 'Identify the risk?',
        fieldType: 'RICH_TEXT',
        sortOrder: 4,
        conditionalLogicJson: {
          showWhen: [{ sectionId: 'sec-needs', fieldId: 'area-risk', operator: 'is_true' }],
        },
      },
      {
        id: 'office-sign',
        sectionId: 'sec-needs',
        label: 'Office signature',
        fieldType: 'SIGNATURE',
        sortOrder: 5,
      },
    ],
  },
];

describe('mapPublishedCarePlanForCarer', () => {
  it('shows labelled questions, Yes/No, and HTML-stripped answers for the carer', () => {
    const sections = mapPublishedCarePlanForCarer({
      formName: 'Washing and dressing',
      formSections: washingForm,
      valuesJson: {
        'sec-pref:wash-type': 'Shower',
        'sec-pref:time-of-day': 'Morning',
        'sec-pref:gender': 'Female',
        'sec-needs:needs': '<p>Needs help to wash back and hair.</p>',
        'sec-needs:goals': '<p>Stay clean and comfortable each morning.</p>',
        'sec-needs:support': '<p>One carer. Use the shower chair. Do not rush.</p>',
        'sec-needs:area-risk': true,
        'sec-needs:risk-identify': '<p>Slip risk on wet bathroom floor.</p>',
        'sec-needs:office-sign': 'data:image/png;base64,abc',
        [DRAFT_NEXT_REVIEW_DATE_KEY]: '2026-12-01',
      },
    });

    expect(sections.map((s) => s.title)).toEqual([
      'Preferences',
      'Needs, goals, support and risk',
    ]);
    expect(sections[0]?.description).toBe('How this person likes personal care.');
    expect(sections[0]?.fields).toEqual([
      { id: 'wash-type', label: 'Preferred wash type', value: 'Shower', fieldType: 'SELECT' },
      { id: 'time-of-day', label: 'Preferred time of day', value: 'Morning', fieldType: 'SELECT' },
      { id: 'gender', label: 'Gender of carer preferred', value: 'Female', fieldType: 'TEXT' },
    ]);
    expect(sections[1]?.fields.map((f) => f.label)).toEqual([
      'What are the service user needs?',
      'What are the service user desired goals/outcomes?',
      'Support required to achieve the desired goals/outcomes?',
      'Is there a risk associated with this area of care?',
      'Identify the risk?',
    ]);
    expect(sections[1]?.fields.find((f) => f.id === 'area-risk')?.value).toBe('Yes');
    expect(sections[1]?.fields.find((f) => f.id === 'needs')?.value).toBe(
      'Needs help to wash back and hair.',
    );
    expect(sections[1]?.fields.find((f) => f.id === 'risk-identify')?.value).toBe(
      'Slip risk on wet bathroom floor.',
    );
    expect(sections.some((s) => s.fields.some((f) => f.fieldType === 'SIGNATURE'))).toBe(false);
    expect(sections.some((s) => s.fields.some((f) => f.label.includes('review')))).toBe(false);
  });

  it('hides unanswered fields and area-risk follow-ups when the gate is No', () => {
    const sections = mapPublishedCarePlanForCarer({
      formName: 'Washing and dressing',
      formSections: washingForm,
      valuesJson: {
        'sec-pref:wash-type': 'Shower',
        'sec-pref:time-of-day': '',
        'sec-needs:area-risk': false,
        'sec-needs:risk-identify': '<p>Should not appear</p>',
      },
    });

    expect(sections).toHaveLength(2);
    expect(sections[0]?.fields.map((f) => f.label)).toEqual(['Preferred wash type']);
    expect(sections[1]?.fields).toEqual([
      {
        id: 'area-risk',
        label: 'Is there a risk associated with this area of care?',
        value: 'No',
        fieldType: 'YES_NO',
      },
    ]);
  });

  it('does not cap fields at 20 and keeps long answers', () => {
    const fields = Array.from({ length: 24 }, (_, i) => ({
      id: `f-${i}`,
      sectionId: 'sec',
      label: `Question ${i + 1}`,
      fieldType: 'TEXTAREA',
      sortOrder: i,
    }));
    const long = 'Support with washing every morning. '.repeat(20).trim();
    const values = Object.fromEntries(fields.map((f) => [`sec:${f.id}`, f.id === 'f-0' ? long : `Answer ${f.id}`]));

    const sections = mapPublishedCarePlanForCarer({
      formName: 'Home Care Plan',
      formSections: [{ id: 'sec', title: 'All details', sortOrder: 0, fields }],
      valuesJson: values,
    });

    expect(sections[0]?.fields).toHaveLength(24);
    expect(sections[0]?.fields[0]?.value.startsWith('Support with washing every morning.')).toBe(true);
    expect(sections[0]?.fields[0]?.value.length).toBeGreaterThan(400);
  });

  it('falls back to flat values without truncating when the form schema is missing', () => {
    const sections = mapPublishedCarePlanForCarer({
      formName: 'Washing and dressing',
      valuesJson: {
        a: true,
        b: '<p>Use the shower chair</p>',
        [DRAFT_NEXT_REVIEW_DATE_KEY]: '2026-12-01',
      },
    });

    expect(sections[0]?.title).toBe('Washing and dressing');
    expect(sections[0]?.fields.map((f) => f.value)).toEqual(['Yes', 'Use the shower chair']);
    expect(sections[0]?.fields.every((f) => f.label === '')).toBe(true);
  });

  it('never uses a generic Detail label, and still matches questions if section ids changed', () => {
    const sections = mapPublishedCarePlanForCarer({
      formName: 'Washing and dressing',
      formSections: washingForm,
      valuesJson: {
        'old-sec:wash-type': 'Shower',
        'old-sec:gender': 'Female',
        '__meta.selectedAssessmentIds': ['a', 'b'],
      },
    });

    expect(sections.flatMap((s) => s.fields.map((f) => f.label))).toEqual([
      'Preferred wash type',
      'Gender of carer preferred',
    ]);
    expect(JSON.stringify(sections)).not.toMatch(/Detail/i);
  });
});

describe('formatCarePlanValueForCarer', () => {
  it('formats booleans, dates, multi-select and attachments', () => {
    expect(formatCarePlanValueForCarer(true, 'YES_NO')).toBe('Yes');
    expect(formatCarePlanValueForCarer(false, 'YES_NO')).toBe('No');
    expect(formatCarePlanValueForCarer('2026-09-11', 'DATE')).toBe('11 Sep 2026');
    expect(formatCarePlanValueForCarer('["Low","Medium"]', 'MULTI_SELECT')).toBe('Low, Medium');
    expect(formatCarePlanValueForCarer('https://files.example/photo.jpg', 'PHOTO')).toBe(
      'Photo attached',
    );
    expect(formatCarePlanValueForCarer('<p><br></p>', 'RICH_TEXT')).toBeNull();
  });
});
