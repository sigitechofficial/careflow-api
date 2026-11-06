/**
 * Survey translations (roadmap Phase 3): a survey in another language or in easy read.
 *
 * Every text people see has a stable key ("path"): the title, introduction, closing message, section
 * headings and introductions, each question, its help text, its answer labels, "Other" and comment
 * prompts, answer headings, and the form's own wording (buttons, errors). A translation stores, per key,
 * the translated text and the English it was translated from. When the English later changes, that
 * key is out of date: it is not shown to people (they see the current English instead) until it is
 * translated again, so a translation never says something the English no longer says.
 *
 * Answers are always stored in English (the canonical answer values): only what people read changes.
 * So results, alerts, trends and CQC evidence are the same whatever language people answer in.
 */

export type TranslationString = { text: string; source: string };
export type TranslationContent = { strings: Record<string, TranslationString> };

export type SurveyLanguage = {
  code: string;
  name: string;
  nativeName: string;
  dir: 'ltr' | 'rtl';
};

/** Easy read: plain English with short sentences, for people with a learning disability (Accessible Information Standard). */
export const EASY_READ = 'en-x-easyread';

/**
 * Languages offered, chosen for adult social care in England (most spoken first languages after English,
 * ONS Census 2021), plus Welsh and easy read. Right-to-left scripts are marked so the page turns.
 */
export const SURVEY_LANGUAGES: SurveyLanguage[] = [
  { code: EASY_READ, name: 'Easy read', nativeName: 'Easy read', dir: 'ltr' },
  { code: 'pl', name: 'Polish', nativeName: 'Polski', dir: 'ltr' },
  { code: 'ro', name: 'Romanian', nativeName: 'Română', dir: 'ltr' },
  { code: 'pa', name: 'Punjabi (Gurmukhi)', nativeName: 'ਪੰਜਾਬੀ', dir: 'ltr' },
  {
    code: 'pa-Arab',
    name: 'Punjabi (Shahmukhi)',
    nativeName: 'پنجابی',
    dir: 'rtl',
  },
  { code: 'ur', name: 'Urdu', nativeName: 'اردو', dir: 'rtl' },
  { code: 'pt', name: 'Portuguese', nativeName: 'Português', dir: 'ltr' },
  { code: 'es', name: 'Spanish', nativeName: 'Español', dir: 'ltr' },
  { code: 'ar', name: 'Arabic', nativeName: 'العربية', dir: 'rtl' },
  { code: 'bn', name: 'Bengali', nativeName: 'বাংলা', dir: 'ltr' },
  { code: 'gu', name: 'Gujarati', nativeName: 'ગુજરાતી', dir: 'ltr' },
  { code: 'it', name: 'Italian', nativeName: 'Italiano', dir: 'ltr' },
  { code: 'lt', name: 'Lithuanian', nativeName: 'Lietuvių', dir: 'ltr' },
  {
    code: 'zh-Hans',
    name: 'Chinese (Simplified)',
    nativeName: '简体中文',
    dir: 'ltr',
  },
  {
    code: 'zh-Hant',
    name: 'Chinese (Traditional)',
    nativeName: '繁體中文',
    dir: 'ltr',
  },
  { code: 'fr', name: 'French', nativeName: 'Français', dir: 'ltr' },
  { code: 'ta', name: 'Tamil', nativeName: 'தமிழ்', dir: 'ltr' },
  { code: 'tr', name: 'Turkish', nativeName: 'Türkçe', dir: 'ltr' },
  { code: 'bg', name: 'Bulgarian', nativeName: 'Български', dir: 'ltr' },
  { code: 'hi', name: 'Hindi', nativeName: 'हिन्दी', dir: 'ltr' },
  { code: 'ml', name: 'Malayalam', nativeName: 'മലയാളം', dir: 'ltr' },
  { code: 'ne', name: 'Nepali', nativeName: 'नेपाली', dir: 'ltr' },
  { code: 'tl', name: 'Tagalog / Filipino', nativeName: 'Tagalog', dir: 'ltr' },
  { code: 'so', name: 'Somali', nativeName: 'Soomaali', dir: 'ltr' },
  { code: 'fa', name: 'Persian (Farsi)', nativeName: 'فارسی', dir: 'rtl' },
  { code: 'ps', name: 'Pashto', nativeName: 'پښتو', dir: 'rtl' },
  { code: 'ckb', name: 'Kurdish (Sorani)', nativeName: 'کوردی', dir: 'rtl' },
  { code: 'ti', name: 'Tigrinya', nativeName: 'ትግርኛ', dir: 'ltr' },
  { code: 'am', name: 'Amharic', nativeName: 'አማርኛ', dir: 'ltr' },
  { code: 'uk', name: 'Ukrainian', nativeName: 'Українська', dir: 'ltr' },
  { code: 'ru', name: 'Russian', nativeName: 'Русский', dir: 'ltr' },
  { code: 'yo', name: 'Yoruba', nativeName: 'Yorùbá', dir: 'ltr' },
  { code: 'tw', name: 'Twi', nativeName: 'Twi', dir: 'ltr' },
  { code: 'sn', name: 'Shona', nativeName: 'chiShona', dir: 'ltr' },
  { code: 'cy', name: 'Welsh', nativeName: 'Cymraeg', dir: 'ltr' },
];

export const LANGUAGE_BY_CODE = new Map(
  SURVEY_LANGUAGES.map((l) => [l.code, l]),
);

/**
 * The answer page's own wording (buttons, notes, errors), translated with the survey so the whole page
 * is in one language. Must match careflow-admin/src/features/surveys/survey-ui-strings.ts.
 * Placeholders in braces ({n}, {question}) are filled in by the page.
 */
export const SURVEY_UI_STRINGS: Record<string, string> = {
  survey: 'Survey',
  forName: 'For {name}',
  anonymousBadge: 'Anonymous responses',
  notLinkedBadge: 'Not linked to your name',
  answeringWithoutName: 'Answering without your name',
  canAnswerWithoutName: 'You can answer without your name',
  questionCountOne: '1 question',
  questionCountMany: '{n} questions',
  requiredNote: 'Questions marked * need an answer.',
  notAccepting: 'This survey is not accepting responses right now.',
  problemTitle: 'There is a problem',
  answerThisQuestion: 'Answer this question',
  describeOther: 'Tell us your “Other” answer',
  chooseWho: 'Choose who is answering this survey',
  problemItem: '{problem}: question {n}, “{question}”',
  answeredCount: 'Answered {n} of {total}',
  requiredLeft: '{n} required left',
  fillOther: 'Please fill in your “Other” answer',
  chooseWhoShort: 'Choose who is answering',
  ready: 'Ready to submit',
  whoIsAnswering: 'Who is answering this survey?',
  whoHint:
    "A family member or representative can answer on the service user's behalf.",
  relationSelf: 'I am the service user',
  relationFamily: 'I am a family member answering for them',
  relationRepresentative: 'I am their representative (e.g. advocate, attorney)',
  yourNameOptional: 'Your name (optional)',
  footerChooseWho: 'Please choose who is answering this survey.',
  footerRequired: 'Please answer all required questions marked with *.',
  footerOther: 'Please tell us your “Other” answer for: {question}',
  footerReady: 'You can submit your response now.',
  submitting: 'Submitting…',
  submit: 'Submit response',
  yes: 'Yes',
  no: 'No',
  yourAnswer: 'Your answer…',
  optional: '(optional)',
  noNames: 'Please do not include names.',
  required: '(required)',
  errorPrefix: 'Error:',
  giveName: 'Do you want to give your name?',
  answerWithName: 'Answer with my name',
  answerWithoutName:
    'Answer without my name — we will not be able to reply to you',
  searchList: 'Search the list',
  searchPlaceholder: 'Type to narrow the list',
  answersCount: '{n} answers',
  nothingMatches: 'Nothing matches. Try fewer letters.',
  thankYouTitle: 'Response recorded',
  thankYou: 'Thank you for completing this survey.',
  language: 'Language',
  displayOptions: 'Display options',
  textSize: 'Text size',
  highContrast: 'High contrast',
  readableFont: 'Easier-to-read font',
  moreSpacing: 'More space between lines',
};

export type SourceString = {
  key: string;
  english: string;
  /** Where it appears, for the translator: "Title", "Question 3", "Question 3 · answer" … */
  where: string;
};

type Q = {
  id: string;
  questionText: string;
  helpText: string | null;
  questionType: string;
  options: unknown;
  otherOption?: unknown;
  commentConfig?: unknown;
  optionGroups?: unknown;
  sectionTitle?: string | null;
  sortOrder: number;
  optionsFrom?: string | null;
};

const str = (v: unknown): string | null =>
  typeof v === 'string' && v.trim() ? v : null;

/** LIKERT stores its labels in `options` too; YES_NO's "Yes"/"No" are the page's own words (ui.yes / ui.no). */
function answerLabels(q: Q): string[] {
  if (q.questionType === 'YES_NO' || q.optionsFrom) return [];
  return Array.isArray(q.options)
    ? (q.options as unknown[]).filter(
        (o): o is string => typeof o === 'string' && o.trim() !== '',
      )
    : [];
}

/**
 * Every English text people see on this survey's answer page, with its key, in page order. CareFlow
 * lists (ethnicity …) are the organisation's own list, not part of the survey, so they are not here.
 */
export function sourceStrings(
  survey: {
    title: string;
    description: string | null;
    closingMessage?: string | null;
    sectionIntros?: unknown;
  },
  questions: Q[],
): SourceString[] {
  const out: SourceString[] = [];
  const push = (key: string, english: string | null, where: string) => {
    if (english && english.trim()) out.push({ key, english, where });
  };
  push('title', survey.title, 'Title');
  push('description', survey.description, 'What people read first');
  const intros =
    survey.sectionIntros && typeof survey.sectionIntros === 'object'
      ? (survey.sectionIntros as Record<string, unknown>)
      : {};
  const seenSections = new Set<string>();
  const ordered = [...questions].sort((a, b) => a.sortOrder - b.sortOrder);
  ordered.forEach((q, i) => {
    const n = i + 1;
    const section = q.sectionTitle?.trim();
    if (section && !seenSections.has(section)) {
      seenSections.add(section);
      push(
        `section:${section}:title`,
        section,
        `Section heading before question ${n}`,
      );
      push(
        `section:${section}:intro`,
        str(intros[section]),
        `Section introduction before question ${n}`,
      );
    }
    push(`q:${q.id}:text`, q.questionText, `Question ${n}`);
    push(`q:${q.id}:help`, q.helpText, `Question ${n} · help text`);
    for (const label of answerLabels(q))
      push(`q:${q.id}:option:${label}`, label, `Question ${n} · answer`);
    const other =
      q.otherOption && typeof q.otherOption === 'object'
        ? (q.otherOption as Record<string, unknown>)
        : null;
    if (other) {
      push(
        `q:${q.id}:otherLabel`,
        str(other.label),
        `Question ${n} · "Other" answer`,
      );
      push(
        `q:${q.id}:otherPrompt`,
        str(other.textPrompt),
        `Question ${n} · "Other" box`,
      );
    }
    const comment =
      q.commentConfig && typeof q.commentConfig === 'object'
        ? (q.commentConfig as Record<string, unknown>)
        : null;
    if (comment)
      push(
        `q:${q.id}:commentPrompt`,
        str(comment.prompt),
        `Question ${n} · comment box`,
      );
    if (Array.isArray(q.optionGroups)) {
      for (const g of q.optionGroups as Array<Record<string, unknown>>) {
        const heading = str(g?.heading);
        if (heading)
          push(
            `q:${q.id}:group:${heading}`,
            heading,
            `Question ${n} · answer heading`,
          );
      }
    }
  });
  push(
    'closingMessage',
    survey.closingMessage ?? null,
    'Shown after they submit',
  );
  for (const [key, english] of Object.entries(SURVEY_UI_STRINGS))
    push(`ui:${key}`, english, 'The page’s own wording');
  return out;
}

export function readTranslationContent(v: unknown): TranslationContent {
  const raw =
    v && typeof v === 'object' && !Array.isArray(v)
      ? (v as { strings?: unknown }).strings
      : null;
  const strings: Record<string, TranslationString> = {};
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    for (const [k, val] of Object.entries(raw as Record<string, unknown>)) {
      const s = val as { text?: unknown; source?: unknown } | null;
      if (s && typeof s.text === 'string' && typeof s.source === 'string')
        strings[k] = { text: s.text, source: s.source };
    }
  }
  return { strings };
}

export type TranslationProgress = {
  total: number;
  done: number;
  outOfDate: number;
  missing: number;
};

/** How much of the survey is translated now: translated and up to date, out of date (English changed), missing. */
export function translationProgress(
  sources: SourceString[],
  content: TranslationContent,
): TranslationProgress {
  let done = 0;
  let outOfDate = 0;
  for (const s of sources) {
    const t = content.strings[s.key];
    if (!t || !t.text.trim()) continue;
    if (t.source === s.english) done += 1;
    else outOfDate += 1;
  }
  return {
    total: sources.length,
    done,
    outOfDate,
    missing: sources.length - done - outOfDate,
  };
}

/** The texts people may see: translated and still matching the current English. Everything else shows in English. */
export function liveStrings(
  sources: SourceString[],
  content: TranslationContent,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const s of sources) {
    const t = content.strings[s.key];
    if (t && t.text.trim() && t.source === s.english) out[s.key] = t.text;
  }
  return out;
}

export const MAX_TRANSLATED_TEXT = 4000;

/**
 * Save edits: each is a key and its translated text, taken as a translation of the current English (an
 * empty text removes it). Keys that are not on the survey are refused, so nothing stray is kept.
 */
export function applyTranslationEdits(
  sources: SourceString[],
  content: TranslationContent,
  edits: Array<{ key: string; text: string }>,
): { content: TranslationContent; unknownKeys: string[] } {
  const byKey = new Map(sources.map((s) => [s.key, s]));
  const strings = { ...content.strings };
  const unknownKeys: string[] = [];
  for (const e of edits) {
    const src = byKey.get(e.key);
    if (!src) {
      unknownKeys.push(e.key);
      continue;
    }
    const text = (e.text ?? '').trim().slice(0, MAX_TRANSLATED_TEXT);
    if (!text) delete strings[e.key];
    else strings[e.key] = { text, source: src.english };
  }
  return { content: { strings }, unknownKeys };
}

/** Keys on questions of a copied survey point at the copy's questions (same order, same text). */
export function remapQuestionKeys(
  content: TranslationContent,
  idMap: ReadonlyMap<string, string>,
): TranslationContent {
  const strings: Record<string, TranslationString> = {};
  for (const [key, val] of Object.entries(content.strings)) {
    const m = /^q:([^:]+):(.*)$/.exec(key);
    if (!m) {
      strings[key] = val;
      continue;
    }
    const to = idMap.get(m[1]);
    if (to) strings[`q:${to}:${m[2]}`] = val;
  }
  return { strings };
}

// ─── The translator's pack (CSV) ─────────────────────────────────────────────

const CSV_HEADER = ['key', 'where', 'english', 'translation'] as const;
/** Byte-order mark: Excel reads the file as UTF-8 with it (other scripts are otherwise garbled). */
const BOM = String.fromCharCode(0xfeff);

function csvCell(v: string): string {
  // Leading = + - @ would be read as a formula by spreadsheet programs (CSV injection): prefixed with '.
  const safe = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** One row per text: its key, where it appears, the English, and the translation so far (blank if none). */
export function translationCsv(
  sources: SourceString[],
  content: TranslationContent,
): string {
  const rows = [CSV_HEADER.join(',')];
  for (const s of sources) {
    const t = content.strings[s.key];
    const current = t && t.source === s.english ? t.text : '';
    rows.push([s.key, s.where, s.english, current].map(csvCell).join(','));
  }
  // A byte-order mark so Excel opens it as UTF-8 (other scripts would otherwise be garbled).
  return `${BOM}${rows.join('\r\n')}\r\n`;
}

/** RFC 4180 CSV (quoted cells, doubled quotes, line breaks in cells). */
export function parseCsv(text: string): string[][] {
  const src = text.startsWith(BOM) ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += c;
      continue;
    }
    if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += c;
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((x) => x.trim() !== ''));
}

const unguard = (v: string) => (/^'[=+\-@\t\r]/.test(v) ? v.slice(1) : v);

export type CsvImportResult = {
  edits: Array<{ key: string; text: string }>;
  /** Rows whose English has changed since the pack was made: not taken (the translation may no longer fit). */
  englishChanged: string[];
  unknownKeys: string[];
  blank: number;
};

/** Read a filled-in pack. A row is taken only when its English still matches the survey's. */
export function readTranslationCsv(
  text: string,
  sources: SourceString[],
): CsvImportResult {
  const rows = parseCsv(text);
  const header = rows.shift()?.map((h) => h.trim().toLowerCase()) ?? [];
  const col = (name: string) => header.indexOf(name);
  const [ki, ei, ti] = [col('key'), col('english'), col('translation')];
  if (ki < 0 || ei < 0 || ti < 0)
    throw new Error(
      'The file needs the columns key, english and translation (as in the pack CareFlow made).',
    );
  const byKey = new Map(sources.map((s) => [s.key, s]));
  const result: CsvImportResult = {
    edits: [],
    englishChanged: [],
    unknownKeys: [],
    blank: 0,
  };
  for (const r of rows) {
    const key = (r[ki] ?? '').trim();
    const english = unguard(r[ei] ?? '');
    const translation = unguard(r[ti] ?? '').trim();
    const src = byKey.get(key);
    if (!src) {
      if (key) result.unknownKeys.push(key);
      continue;
    }
    if (!translation) {
      result.blank += 1;
      continue;
    }
    if (english.trim() !== src.english.trim()) {
      result.englishChanged.push(key);
      continue;
    }
    result.edits.push({ key, text: translation });
  }
  return result;
}
