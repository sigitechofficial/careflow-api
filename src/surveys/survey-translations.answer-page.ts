import type { Survey } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service';
import {
  LANGUAGE_BY_CODE,
  liveStrings,
  readTranslationContent,
  remapQuestionKeys,
  sourceStrings,
} from './survey-translation.util';

/**
 * The parts of survey translations the answer page and survey copies need (used by SurveysService, so
 * kept apart from SurveyTranslationsService, which itself uses SurveysService).
 */
export const TRANSLATION_STATUS = {
  DRAFT: 'DRAFT',
  PUBLISHED: 'PUBLISHED',
} as const;

export const QUESTION_SELECT = {
  id: true,
  questionText: true,
  helpText: true,
  questionType: true,
  options: true,
  otherOption: true,
  commentConfig: true,
  optionGroups: true,
  sectionTitle: true,
  sortOrder: true,
  optionsFrom: true,
  sourceQuestionId: true,
} as const;

export type SourceSurvey = Pick<
  Survey,
  | 'id'
  | 'title'
  | 'description'
  | 'closingMessage'
  | 'sectionIntros'
  | 'clonedFromId'
>;

type Db = Pick<
  PrismaService,
  'survey' | 'surveyQuestion' | 'surveyTranslation'
>;

/**
 * Published translations for the answer page: each language's texts that are translated and still
 * match the English (anything else shows in English). A period uses its repeating survey's
 * translations, matched through each question's sourceQuestionId.
 */
export async function translationsForAnswerPage(
  prisma: Db,
  survey: SourceSurvey,
): Promise<{
  languages: Array<{
    code: string;
    name: string;
    nativeName: string;
    dir: 'ltr' | 'rtl';
  }>;
  translations: Record<string, Record<string, string>>;
  closingMessages: Record<string, string>;
}> {
  const ownerId = survey.clonedFromId ?? survey.id;
  const rows = await prisma.surveyTranslation
    .findMany({
      where: { surveyId: ownerId, status: TRANSLATION_STATUS.PUBLISHED },
      orderBy: { language: 'asc' },
    })
    .catch(() => []);
  if (!rows.length)
    return { languages: [], translations: {}, closingMessages: {} };
  const questions = await prisma.surveyQuestion.findMany({
    where: { surveyId: survey.id, deletedAt: null, isActive: true },
    select: QUESTION_SELECT,
  });
  // Translations are kept against the repeating survey's questions; a period's question came from one
  // (sourceQuestionId). Texts are matched there, then keyed by this survey's own question ids.
  const ownerIdOf = new Map(
    questions.map((q) => [
      q.id,
      ownerId !== survey.id && q.sourceQuestionId ? q.sourceQuestionId : q.id,
    ]),
  );
  // A period is titled "<repeating survey's title> — <period>": the title is matched on the repeating
  // survey's own title, and the period added back after it.
  let periodSuffix = '';
  let matchTitle = survey.title;
  if (ownerId !== survey.id) {
    const owner = await prisma.survey
      .findUnique({ where: { id: ownerId }, select: { title: true } })
      .catch(() => null);
    if (owner && survey.title.startsWith(`${owner.title} — `)) {
      matchTitle = owner.title;
      periodSuffix = survey.title.slice(owner.title.length);
    }
  }
  const ownerSources = sourceStrings(
    { ...survey, title: matchTitle },
    questions.map((q) => ({ ...q, id: ownerIdOf.get(q.id)! })),
  );
  const thisIdOf = new Map(
    [...ownerIdOf.entries()].map(([own, owner]) => [owner, own]),
  );
  const languages: Array<{
    code: string;
    name: string;
    nativeName: string;
    dir: 'ltr' | 'rtl';
  }> = [];
  const translations: Record<string, Record<string, string>> = {};
  const closingMessages: Record<string, string> = {};
  for (const r of rows) {
    const lang = LANGUAGE_BY_CODE.get(r.language);
    if (!lang) continue;
    const live: Record<string, string> = {};
    for (const [key, text] of Object.entries(
      liveStrings(ownerSources, readTranslationContent(r.content)),
    )) {
      const m = /^q:([^:]+):(.*)$/.exec(key);
      live[m ? `q:${thisIdOf.get(m[1]) ?? m[1]}:${m[2]}` : key] = text;
    }
    if (live.title && periodSuffix) live.title = `${live.title}${periodSuffix}`;
    // The closing message goes back with a submit only (it can hold quiz answers), never in the form.
    if (live.closingMessage) closingMessages[r.language] = live.closingMessage;
    delete live.closingMessage;
    languages.push({
      code: lang.code,
      name: lang.name,
      nativeName: lang.nativeName,
      dir: lang.dir,
    });
    translations[lang.code] = live;
  }
  return { languages, translations, closingMessages };
}

/** A copied survey takes the source's translations, its questions matched in order (same text). */
export async function copySurveyTranslations(
  prisma: Db,
  fromSurveyId: string,
  toSurveyId: string,
): Promise<number> {
  const rows = await prisma.surveyTranslation.findMany({
    where: { surveyId: fromSurveyId },
  });
  if (!rows.length) return 0;
  const [from, to] = await Promise.all([
    prisma.surveyQuestion.findMany({
      where: { surveyId: fromSurveyId, deletedAt: null },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      select: { id: true, questionText: true },
    }),
    prisma.surveyQuestion.findMany({
      where: { surveyId: toSurveyId, deletedAt: null },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      select: { id: true, questionText: true },
    }),
  ]);
  const idMap = new Map<string, string>();
  const unused = [...to];
  for (const q of from) {
    const i = unused.findIndex((t) => t.questionText === q.questionText);
    if (i >= 0) idMap.set(q.id, unused.splice(i, 1)[0].id);
  }
  for (const r of rows) {
    await prisma.surveyTranslation.create({
      data: {
        surveyId: toSurveyId,
        language: r.language,
        // A copy is a new survey: its translations start as drafts until someone publishes them.
        status: TRANSLATION_STATUS.DRAFT,
        content: remapQuestionKeys(readTranslationContent(r.content), idMap),
      },
    });
  }
  return rows.length;
}
