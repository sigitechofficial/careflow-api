import {
  assessmentConsentRows,
  assessmentPrivacyAnswers,
  carerSharingNotes,
  communicationNeedsWords,
  mergeConsentChanges,
  sharingIsActive,
  sharingStatus,
  suggestedSurveyLanguage,
} from './service-user-privacy.util';

const d = (s: string) => new Date(`${s}T00:00:00.000Z`);
const answer = (over: Partial<{ checked: boolean | null; booleanValue: boolean | null; textValue: string | null; selectedOptions: unknown }>) => ({
  checked: null,
  booleanValue: null,
  textValue: null,
  selectedOptions: null,
  ...over,
});

describe('privacy helpers', () => {
  it('a sharing line is active from its start to its end, and never once stopped', () => {
    const line = { startsOn: d('2026-11-01'), endsOn: d('2026-11-30'), stoppedAt: null };
    expect(sharingIsActive(line, '2026-10-31')).toBe(false);
    expect(sharingIsActive(line, '2026-11-01')).toBe(true);
    expect(sharingIsActive(line, '2026-11-30')).toBe(true);
    expect(sharingIsActive(line, '2026-12-01')).toBe(false);
    expect(sharingIsActive({ ...line, stoppedAt: new Date() }, '2026-11-10')).toBe(false);
    expect(sharingIsActive({ ...line, endsOn: null }, '2030-01-01')).toBe(true);
  });

  it('says whether a line is active, not started, ended, stopped or due a review', () => {
    const base = { startsOn: d('2026-11-01'), endsOn: null, stoppedAt: null, reviewOn: null };
    expect(sharingStatus(base, '2026-11-08')).toBe('ACTIVE');
    expect(sharingStatus(base, '2026-10-01')).toBe('NOT_STARTED');
    expect(sharingStatus({ ...base, endsOn: d('2026-11-05') }, '2026-11-08')).toBe('ENDED');
    expect(sharingStatus({ ...base, stoppedAt: new Date() }, '2026-11-08')).toBe('STOPPED');
    expect(sharingStatus({ ...base, reviewOn: d('2026-11-08') }, '2026-11-08')).toBe('REVIEW_DUE');
  });

  it('puts communication needs in one short line', () => {
    expect(communicationNeedsWords(null)).toBe('');
    expect(
      communicationNeedsWords({ interpreterNeeded: true, interpreterLanguage: 'Polish', formats: ['LARGE_PRINT', 'NOT_A_FORMAT'], contactViaName: 'Ann Smith' }),
    ).toBe('Large print · Interpreter: Polish · Contact through Ann Smith');
    expect(communicationNeedsWords({ interpreterNeeded: true, interpreterLanguage: ' ', formats: [] })).toBe('Interpreter');
  });

  it('reads the assessment’s answers on communication and sharing', () => {
    const got = assessmentPrivacyAnswers({
      byText: new Map([
        ['Interpreter required?', answer({ booleanValue: true })],
        ['Language required', answer({ textValue: '<p>Polish</p>' })],
        ['Easy read or large print required?', answer({ checked: true })],
      ]),
      byKey: new Map([
        ['hearingLevel', answer({ selectedOptions: ['moderate_loss'] })],
        ['sightLevel', answer({ selectedOptions: ['no_concern'] })],
        ['infoSharingConsent', answer({ booleanValue: true })],
        ['infoSharingWith', answer({ selectedOptions: ['gp', 'family_representatives'] })],
        ['infoSharingLimits', answer({ textValue: 'Not her finances' })],
        ['partialConsentRefusal', answer({ booleanValue: true })],
        ['partialConsentRefusalDetails', answer({ textValue: 'No updates to her son' })],
      ]),
    });
    expect(got.needs).toEqual({
      interpreterNeeded: true,
      interpreterLanguage: 'Polish',
      easyReadOrLargePrint: true,
      hearing: 'Moderate loss',
      sight: '',
    });
    expect(got.sharing).toEqual({
      consent: 'YES',
      with: ['GP', 'Family or representatives'],
      limits: 'Not her finances',
      restrictions: '',
      conditions: 'No updates to her son',
    });
  });

  it('an unanswered assessment gives nothing to fill', () => {
    const got = assessmentPrivacyAnswers({ byText: new Map(), byKey: new Map() });
    expect(got.needs.interpreterNeeded).toBe(false);
    expect(got.sharing.consent).toBe('NOT_ANSWERED');
    expect(got.sharing.with).toEqual([]);
  });

  it('gathers the assessment’s consents and capacity decisions into the consent record', () => {
    const rows = assessmentConsentRows(
      new Map([
        ['consentToAssessment', answer({ booleanValue: true })],
        ['consentMethod', answer({ selectedOptions: ['verbal'] })],
        ['familyInvolvementConsent', answer({ booleanValue: false })],
        ['infoSharingConsent', answer({ booleanValue: true })],
        ['infoSharingWith', answer({ selectedOptions: ['gp'] })],
        ['consentToCare', answer({ booleanValue: true })],
        ['partialConsentRefusal', answer({ booleanValue: true })],
        ['partialConsentRefusalDetails', answer({ textValue: 'No personal care from male carers' })],
      ]),
      [
        { id: 'd1', decision: 'covert_medication', outcome: 'lacks_capacity', bestInterestsOutcome: 'Crushed in yoghurt', bestInterestsDecisionMaker: 'Dr Patel', assessedOn: '2026-11-02' },
        { id: 'd2', decision: 'photography', outcome: 'has_capacity', assessorName: 'Sam Lee' },
        { id: 'd3', decision: 'bed_rails' },
      ],
      '2026-11-01',
    );
    const by = (key: string) => rows.find((r) => r.key === key)!;
    expect(by('ia-assessment')).toMatchObject({ answer: 'GIVEN', detail: 'Given verbally.', on: '2026-11-01' });
    expect(by('ia-family').answer).toBe('REFUSED');
    expect(by('ia-sharing')).toMatchObject({ answer: 'GIVEN', detail: 'With: GP.' });
    expect(by('ia-care')).toMatchObject({ answer: 'PARTLY', detail: 'Not consented to, or conditions: No personal care from male carers.' });
    expect(by('capacity-d1')).toMatchObject({
      title: 'Covert medication',
      answer: 'BEST_INTERESTS',
      detail: 'Best-interests decision: Crushed in yoghurt. Decision maker: Dr Patel.',
      on: '2026-11-02',
    });
    expect(by('capacity-d2')).toMatchObject({ answer: 'HAS_CAPACITY', detail: 'Able to make this decision themselves; assessed by Sam Lee.' });
    // A decision with no outcome yet is not a consent.
    expect(rows.find((r) => r.key === 'capacity-d3')).toBeUndefined();
  });

  it('opens a person’s survey link in easy read or their language when the survey has it', () => {
    const offered = [
      { code: 'pl', name: 'Polish', nativeName: 'Polski' },
      { code: 'en-x-easyread', name: 'Easy read', nativeName: 'Easy read' },
    ];
    expect(suggestedSurveyLanguage({ formats: ['EASY_READ'], interpreterNeeded: true, interpreterLanguage: 'Polish' }, offered)).toBe('en-x-easyread');
    expect(suggestedSurveyLanguage({ formats: [], interpreterNeeded: true, interpreterLanguage: 'polski' }, offered)).toBe('pl');
    expect(suggestedSurveyLanguage({ formats: [], interpreterNeeded: true, interpreterLanguage: 'Urdu' }, offered)).toBeNull();
    expect(suggestedSurveyLanguage({ formats: ['LARGE_PRINT'], interpreterNeeded: false, interpreterLanguage: '' }, offered)).toBeNull();
    expect(suggestedSurveyLanguage(null, offered)).toBeNull();
  });

  it('tells carers who they may tell what, and who not to share with', () => {
    const line = (over: Record<string, unknown>) => ({
      recipientName: 'Ann Smith',
      recipientRole: 'Daughter',
      contactId: 'c1',
      categories: ['CARE_UPDATES', 'VISIT_TIMES'],
      conditions: '',
      startsOn: d('2026-11-01'),
      endsOn: null,
      stoppedAt: null,
      ...over,
    });
    expect(
      carerSharingNotes(
        [
          line({ conditions: 'Not her finances' }),
          line({ recipientName: 'Tom Smith', recipientRole: 'Son', contactId: 'c2', stoppedAt: new Date() }),
          line({ recipientName: 'Old line', contactId: 'c1', stoppedAt: new Date() }),
        ] as never,
        '2026-11-08',
      ),
    ).toEqual([
      'Ann Smith (Daughter) may be told: day-to-day care updates, visit times and carers. Not her finances',
      'Do not share information with Tom Smith',
    ]);
  });

  it('a change recorded after the assessment is the consent now, with the assessment in its history', () => {
    const rows = [
      { key: 'ia-care', title: 'Consent to receive care and support', answer: 'GIVEN' as const, detail: '', on: '2026-11-01', source: 'INITIAL_ASSESSMENT' as const },
      { key: 'visits', title: 'Consent to care at each visit', answer: 'RECORDED' as const, detail: 'x', on: null, source: 'VISITS' as const },
    ];
    const change = (over: Record<string, unknown>) => ({
      topic: 'CARE',
      title: '',
      answer: 'PARTLY',
      method: 'verbal',
      givenBy: '',
      details: 'No personal care from male carers',
      decidedOn: d('2026-11-05'),
      createdAt: new Date('2026-11-05T10:00:00Z'),
      recordedBy: 'Sam Lee',
      ...over,
    });
    const merged = mergeConsentChanges(rows, [
      change({}),
      change({ answer: 'WITHDRAWN', method: 'representative', givenBy: 'Ann Smith, attorney', details: 'Moving to a care home', decidedOn: d('2026-11-08'), createdAt: new Date('2026-11-08T09:00:00Z') }),
      change({ topic: 'OTHER', title: 'Being filmed for training', answer: 'REFUSED', method: '', details: '', decidedOn: d('2026-11-06') }),
    ]);
    const care = merged.find((r) => r.key === 'ia-care')!;
    expect(care).toMatchObject({
      title: 'Consent to receive care and support',
      answer: 'WITHDRAWN',
      detail: 'By Ann Smith, attorney, by their representative. Moving to a care home',
      on: '2026-11-08',
      source: 'CHANGE',
      topic: 'CARE',
      recordedBy: 'Sam Lee',
    });
    expect(care.history!.map((h) => [h.answer, h.on, h.source])).toEqual([
      ['PARTLY', '2026-11-05', 'CHANGE'],
      ['GIVEN', '2026-11-01', 'INITIAL_ASSESSMENT'],
    ]);
    expect(care.history![0].detail).toBe('Verbally. No personal care from male carers');
    expect(merged.find((r) => r.key === 'visits')).toEqual(rows[1]);
    expect(merged.find((r) => r.title === 'Being filmed for training')).toMatchObject({ answer: 'REFUSED', topic: 'OTHER', history: [] });
  });
});

describe('carerPhotoConsent', () => {
  const { carerPhotoConsent } = jest.requireActual('./service-user-privacy.util') as typeof import('./service-user-privacy.util');
  it('is null when nothing is recorded', () => {
    expect(carerPhotoConsent(null)).toBeNull();
  });
  it('tells the carer not to take photos when refused or withdrawn', () => {
    expect(carerPhotoConsent({ answer: 'REFUSED', details: '', decidedOn: new Date('2026-11-03') })).toEqual({
      answer: 'REFUSED',
      note: 'Refused consent to photographs (2026-11-03). Do not take photos; record on the body map without one and tell the office.',
    });
    expect(carerPhotoConsent({ answer: 'WITHDRAWN', details: 'Upset by the camera.', decidedOn: '2026-11-04' })?.note).toContain('Withdrew');
  });
  it('passes on limits when agreed in part', () => {
    expect(carerPhotoConsent({ answer: 'PARTLY', details: 'Not of her face.', decidedOn: '2026-11-04' })?.note).toBe(
      'Agreed to some photographs only (2026-11-04). Not of her face.',
    );
  });
});
