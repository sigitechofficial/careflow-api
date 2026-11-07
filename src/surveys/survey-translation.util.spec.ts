import {
  EASY_READ,
  LANGUAGE_BY_CODE,
  SURVEY_UI_STRINGS,
  applyTranslationEdits,
  liveStrings,
  parseCsv,
  readTranslationContent,
  readTranslationCsv,
  remapQuestionKeys,
  sourceStrings,
  translationCsv,
  translationProgress,
} from './survey-translation.util';

const survey = {
  title: 'Your care',
  description: 'Tell us how it is going.',
  closingMessage: 'Thank you.',
  sectionIntros: { 'Your visits': 'About your visits.' },
};
const questions = [
  {
    id: 'q1',
    questionText: 'Are your carers on time?',
    helpText: 'Think about the last month.',
    questionType: 'SINGLE_SELECT',
    options: ['Always', 'Sometimes', 'Never'],
    otherOption: { label: 'Other', textPrompt: 'Please tell us' },
    commentConfig: { prompt: 'Why?' },
    optionGroups: [{ heading: 'Usually', options: ['Always'] }],
    sectionTitle: 'Your visits',
    sortOrder: 0,
  },
  { id: 'q2', questionText: 'Do you feel safe?', helpText: null, questionType: 'YES_NO', options: null, sortOrder: 1, sectionTitle: 'Your visits' },
  { id: 'q3', questionText: 'Your ethnic group', helpText: null, questionType: 'SINGLE_SELECT', options: ['White British'], optionsFrom: 'ETHNICITY', sortOrder: 2 },
];

describe('survey translations: the texts to translate', () => {
  const sources = sourceStrings(survey, questions);
  const keys = sources.map((s) => s.key);

  it('lists every text people see, in page order, with where it appears', () => {
    expect(keys.slice(0, 14)).toEqual([
      'title',
      'description',
      'section:Your visits:title',
      'section:Your visits:intro',
      'q:q1:text',
      'q:q1:help',
      'q:q1:option:Always',
      'q:q1:option:Sometimes',
      'q:q1:option:Never',
      'q:q1:otherLabel',
      'q:q1:otherPrompt',
      'q:q1:commentPrompt',
      'q:q1:group:Usually',
      'q:q2:text',
    ]);
    expect(sources.find((s) => s.key === 'q:q1:option:Always')!.where).toBe('Question 1 · answer');
    expect(keys).toContain('closingMessage');
    expect(keys).toContain('ui:submit');
    expect(keys.filter((k) => k.startsWith('ui:'))).toHaveLength(Object.keys(SURVEY_UI_STRINGS).length);
  });

  it('Yes/No are the page’s own words, and a CareFlow list is the organisation’s list, not translated per survey', () => {
    expect(keys.some((k) => k.startsWith('q:q2:option:'))).toBe(false);
    expect(keys).toContain('q:q3:text');
    expect(keys.some((k) => k.startsWith('q:q3:option:'))).toBe(false);
  });

  it('knows easy read and right-to-left languages', () => {
    expect(LANGUAGE_BY_CODE.get(EASY_READ)!.name).toBe('Easy read');
    expect(LANGUAGE_BY_CODE.get('ur')!.dir).toBe('rtl');
    expect(LANGUAGE_BY_CODE.get('pl')!.dir).toBe('ltr');
  });
});

describe('survey translations: keeping them true to the English', () => {
  const sources = sourceStrings(survey, questions);

  it('saves edits against the current English, removes empty ones and refuses keys not on the survey', () => {
    const { content, unknownKeys } = applyTranslationEdits(sources, { strings: {} }, [
      { key: 'title', text: '  Twoja opieka  ' },
      { key: 'q:q1:text', text: 'Czy opiekunowie są na czas?' },
      { key: 'nope', text: 'x' },
    ]);
    expect(unknownKeys).toEqual(['nope']);
    expect(content.strings.title).toEqual({ text: 'Twoja opieka', source: 'Your care' });
    const removed = applyTranslationEdits(sources, content, [{ key: 'title', text: '' }]).content;
    expect(removed.strings.title).toBeUndefined();
    expect(removed.strings['q:q1:text']).toBeDefined();
  });

  it('a translation of English that has since changed is out of date and never shown to people', () => {
    const content = applyTranslationEdits(sources, { strings: {} }, [
      { key: 'title', text: 'Twoja opieka' },
      { key: 'q:q1:text', text: 'Czy opiekunowie są na czas?' },
    ]).content;
    const changed = sourceStrings({ ...survey, title: 'Your care and support' }, questions);
    const progress = translationProgress(changed, content);
    expect(progress).toMatchObject({ done: 1, outOfDate: 1 });
    expect(progress.missing).toBe(changed.length - 2);
    const live = liveStrings(changed, content);
    expect(live).toEqual({ 'q:q1:text': 'Czy opiekunowie są na czas?' });
  });

  it('reads stored content defensively', () => {
    expect(readTranslationContent(null)).toEqual({ strings: {} });
    expect(readTranslationContent({ strings: { a: { text: 'x', source: 'y' }, b: { text: 1 }, c: 'z' } })).toEqual({
      strings: { a: { text: 'x', source: 'y' } },
    });
  });

  it('a copied survey’s translations point at the copy’s questions', () => {
    const content = { strings: { title: { text: 'T', source: 'S' }, 'q:q1:text': { text: 'A', source: 'B' }, 'q:gone:text': { text: 'C', source: 'D' } } };
    expect(remapQuestionKeys(content, new Map([['q1', 'n1']])).strings).toEqual({
      title: { text: 'T', source: 'S' },
      'q:n1:text': { text: 'A', source: 'B' },
    });
  });
});

describe('the translator’s pack (CSV)', () => {
  const sources = sourceStrings(survey, questions);

  it('round-trips: export, fill in, import (commas, quotes and line breaks in cells; UTF-8 mark for Excel)', () => {
    const csv = translationCsv(sources, { strings: {} });
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    const rows = parseCsv(csv);
    expect(rows[0]).toEqual(['key', 'where', 'english', 'translation']);
    const filled = rows
      .map((r, i) => (i === 0 ? r : r[0] === 'q:q1:text' ? [r[0]!, r[1]!, r[2]!, 'Czy, "zawsze"\nna czas?'] : r))
      .map((r) => r.map((c) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(','))
      .join('\r\n');
    const read = readTranslationCsv(filled, sources);
    expect(read.edits).toEqual([{ key: 'q:q1:text', text: 'Czy, "zawsze"\nna czas?' }]);
    expect(read.blank).toBe(sources.length - 1);
  });

  it('a row whose English changed since the pack was made is not taken', () => {
    const csv = 'key,where,english,translation\r\ntitle,Title,Old title,Stary tytuł\r\nq:q2:text,Q2,Do you feel safe?,Czy czujesz się bezpiecznie?\r\n';
    const read = readTranslationCsv(csv, sources);
    expect(read.englishChanged).toEqual(['title']);
    expect(read.edits).toEqual([{ key: 'q:q2:text', text: 'Czy czujesz się bezpiecznie?' }]);
  });

  it('guards cells a spreadsheet would run as a formula, and undoes it on import', () => {
    const s = sourceStrings({ title: '=1+1', description: null }, []);
    const csv = translationCsv(s, { strings: { title: { text: '-oops', source: '=1+1' } } });
    expect(csv).toContain(`'=1+1`);
    expect(csv).toContain(`'-oops`);
    expect(readTranslationCsv(csv, s).edits).toEqual([{ key: 'title', text: '-oops' }]);
  });

  it('refuses a file without the columns it needs', () => {
    expect(() => readTranslationCsv('a,b\r\n1,2', sources)).toThrow(/key, english and translation/);
  });
});
