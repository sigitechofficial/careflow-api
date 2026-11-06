import { BadRequestException } from '@nestjs/common';
import { SurveyTranslationsService } from './survey-translations.service';
import { copySurveyTranslations, translationsForAnswerPage } from './survey-translations.answer-page';
import { sourceStrings } from './survey-translation.util';

const actor: any = { id: 'u1', roles: ['Super Admin'], permissions: [] };

const owner = {
  id: 'S',
  title: 'Staff survey',
  description: 'Tell us.',
  closingMessage: 'Thanks.',
  sectionIntros: null,
  clonedFromId: null,
  isCatalogue: false,
};
const ownerQuestions = [
  { id: 'a', questionText: 'Are you supported?', helpText: null, questionType: 'YES_NO', options: null, sortOrder: 0, sourceQuestionId: null },
  { id: 'b', questionText: 'How often?', helpText: null, questionType: 'SINGLE_SELECT', options: ['Often', 'Rarely'], sortOrder: 1, sourceQuestionId: null },
];

function db(rows: any[] = [], questionsBySurvey: Record<string, any[]> = { S: ownerQuestions }, surveys: Record<string, any> = { S: owner }) {
  const prisma: any = {
    surveyTranslation: {
      findMany: jest.fn(async ({ where }: any) =>
        rows.filter((r) => r.surveyId === where.surveyId && (!where.status || r.status === where.status)),
      ),
      findUnique: jest.fn(async ({ where }: any) =>
        rows.find((r) => r.surveyId === where.surveyId_language.surveyId && r.language === where.surveyId_language.language) ?? null,
      ),
      upsert: jest.fn(async ({ where, create, update }: any) => {
        const existing = rows.find((r) => r.surveyId === where.surveyId_language.surveyId && r.language === where.surveyId_language.language);
        if (existing) Object.assign(existing, update);
        else rows.push({ id: `t${rows.length}`, updatedAt: new Date(), publishedAt: null, ...create });
      }),
      update: jest.fn(async ({ where, data }: any) => Object.assign(rows.find((r) => r.id === where.id), data)),
      deleteMany: jest.fn(async () => ({ count: 1 })),
      create: jest.fn(async ({ data }: any) => rows.push({ id: `t${rows.length}`, ...data })),
    },
    surveyQuestion: {
      findMany: jest.fn(async ({ where }: any) => questionsBySurvey[where.surveyId] ?? []),
    },
    survey: {
      findUnique: jest.fn(async ({ where }: any) => surveys[where.id] ?? null),
      findUniqueOrThrow: jest.fn(async ({ where }: any) => surveys[where.id]),
    },
  };
  return { prisma, rows };
}

function service(prisma: any, survey: any = owner) {
  const surveys: any = { visibleSurvey: jest.fn(async () => survey), editableSurvey: jest.fn(async () => survey) };
  const audit: any = { logAudit: jest.fn() };
  return { svc: new SurveyTranslationsService(prisma, surveys, audit), audit };
}

/** Every survey text (not the page's own wording, not the closing message) translated. */
function fullTranslation(questions = ownerQuestions) {
  const strings: Record<string, { text: string; source: string }> = {};
  for (const s of sourceStrings(owner, questions)) {
    if (s.key.startsWith('ui:') || s.key === 'closingMessage') continue;
    strings[s.key] = { text: `PL ${s.english}`, source: s.english };
  }
  return { strings };
}

describe('SurveyTranslationsService', () => {
  it('saves texts as a draft, audited as counts only, and refuses unknown languages and keys', async () => {
    const { prisma, rows } = db();
    const { svc, audit } = service(prisma);
    await svc.save(actor, 'S', 'pl', [{ key: 'title', text: 'Ankieta' }]);
    expect(rows[0]).toMatchObject({ surveyId: 'S', language: 'pl', status: 'DRAFT' });
    expect(audit.logAudit).toHaveBeenCalledWith(expect.objectContaining({ newValues: { language: 'pl', change: 'saved', texts: 1 } }));
    await expect(svc.save(actor, 'S', 'xx', [{ key: 'title', text: 'x' }])).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.save(actor, 'S', 'pl', [{ key: 'q:nope:text', text: 'x' }])).rejects.toThrow(/no longer on this survey/);
  });

  it('publishes only when every survey text is translated and up to date (the page’s own wording may fall back)', async () => {
    const { prisma, rows } = db([{ id: 't0', surveyId: 'S', language: 'pl', status: 'DRAFT', content: { strings: { title: { text: 'Ankieta', source: 'Staff survey' } } }, updatedAt: new Date() }]);
    const { svc } = service(prisma);
    await expect(svc.publish(actor, 'S', 'pl')).rejects.toThrow(/still need translating/);
    rows[0].content = fullTranslation();
    await svc.publish(actor, 'S', 'pl');
    expect(rows[0].status).toBe('PUBLISHED');
  });

  it('is edited on the repeating survey, never on one period', async () => {
    const { prisma } = db();
    const { svc } = service(prisma, { ...owner, id: 'P', clonedFromId: 'S' });
    await expect(svc.save(actor, 'P', 'pl', [{ key: 'title', text: 'x' }])).rejects.toThrow(/repeating survey/);
  });

  it('imports a pack, taking rows whose English still matches', async () => {
    const { prisma, rows } = db();
    const { svc } = service(prisma);
    const csv = 'key,where,english,translation\r\ntitle,Title,Staff survey,Ankieta\r\nq:b:text,Q2,Old wording,Stare\r\n';
    const res = await svc.importCsv(actor, 'S', 'pl', csv);
    expect(res.data.imported).toMatchObject({ taken: 1, englishChanged: ['q:b:text'] });
    expect(rows[0].content.strings.title.text).toBe('Ankieta');
  });
});

describe('translations on the answer page', () => {
  it('offers published languages with only up-to-date texts; the closing message comes back separately', async () => {
    const content = fullTranslation();
    content.strings.closingMessage = { text: 'Dzięki.', source: 'Thanks.' };
    content.strings['ui:submit'] = { text: 'Wyślij', source: 'Submit response' };
    const { prisma } = db([
      { surveyId: 'S', language: 'pl', status: 'PUBLISHED', content },
      { surveyId: 'S', language: 'ro', status: 'DRAFT', content: fullTranslation() },
    ]);
    const out = await translationsForAnswerPage(prisma, owner);
    expect(out.languages.map((l) => l.code)).toEqual(['pl']);
    expect(out.translations.pl.title).toBe('PL Staff survey');
    expect(out.translations.pl['ui:submit']).toBe('Wyślij');
    expect(out.translations.pl.closingMessage).toBeUndefined();
    expect(out.closingMessages).toEqual({ pl: 'Dzięki.' });
  });

  it('a period uses its repeating survey’s translations, keyed by its own questions, with the period added to the title', async () => {
    const period = { ...owner, id: 'P', title: 'Staff survey — March 2027', clonedFromId: 'S' };
    const periodQuestions = ownerQuestions.map((q) => ({ ...q, id: `p-${q.id}`, sourceQuestionId: q.id }));
    const { prisma } = db([{ surveyId: 'S', language: 'pl', status: 'PUBLISHED', content: fullTranslation() }], { S: ownerQuestions, P: periodQuestions }, { S: owner, P: period });
    const out = await translationsForAnswerPage(prisma, period);
    expect(out.translations.pl.title).toBe('PL Staff survey — March 2027');
    expect(out.translations.pl['q:p-b:text']).toBe('PL How often?');
    expect(out.translations.pl['q:p-b:option:Often']).toBe('PL Often');
    expect(out.translations.pl['q:b:text']).toBeUndefined();
  });

  it('nothing published: nothing offered', async () => {
    const { prisma } = db();
    expect(await translationsForAnswerPage(prisma, owner)).toEqual({ languages: [], translations: {}, closingMessages: {} });
  });
});

describe('copying a survey', () => {
  it('copies translations as drafts, matched to the copy’s questions by text in order', async () => {
    const { prisma, rows } = db(
      [{ surveyId: 'S', language: 'pl', status: 'PUBLISHED', content: fullTranslation() }],
      { S: ownerQuestions, C: ownerQuestions.map((q) => ({ ...q, id: `c-${q.id}` })) },
    );
    expect(await copySurveyTranslations(prisma, 'S', 'C')).toBe(1);
    const copy = rows.find((r) => r.surveyId === 'C');
    expect(copy.status).toBe('DRAFT');
    expect(copy.content.strings['q:c-a:text'].text).toBe('PL Are you supported?');
    expect(copy.content.strings['q:a:text']).toBeUndefined();
  });
});
