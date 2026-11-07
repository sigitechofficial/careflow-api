import { SurveySectionsService } from './survey-sections.service';
import { introsForQuestions, sectionIntrosForCopy, sectionIntrosOf, splitSections } from './survey-sections.util';

const at = new Date('2026-11-01T09:00:00Z');
const q = (id: string, sortOrder: number, sectionTitle: string | null, over: Record<string, unknown> = {}) => ({
  id,
  key: id,
  questionText: `Question ${id}`,
  questionType: 'YES_NO',
  options: null,
  config: null,
  otherOption: null,
  showIf: null,
  sortOrder,
  createdAt: at,
  sectionTitle,
  ...over,
});

function setup(questions: any[], survey: Record<string, unknown> = {}, scope: string[] | null = null) {
  const row = { id: 's1', title: 'Staff survey', isTemplate: false, isCatalogue: false, deletedAt: null, locationIds: [], sectionIntros: null, libraryMeta: null, ...survey };
  const prisma: any = {
    survey: { findFirst: jest.fn().mockResolvedValue(row), update: jest.fn() },
    surveyQuestion: { findMany: jest.fn().mockResolvedValue(questions), updateMany: jest.fn(), update: jest.fn() },
    $transaction: jest.fn(async (cb: any) => cb(prisma)),
    $executeRaw: jest.fn().mockResolvedValue(1),
  };
  const audit = { logAudit: jest.fn() };
  const orgScope = { fromRequestUser: () => ({ locationIds: scope }) };
  return { prisma, audit, service: new SurveySectionsService(prisma, audit as any, orgScope as any) };
}
const actor: any = { id: 'u1', roles: ['Admin'], permissions: ['surveys.manage'] };
/** The introductions saved (raw SQL, so updatedAt is untouched); undefined when none were saved. */
const introsSaved = (prisma: any) => {
  const call = prisma.$executeRaw.mock.calls.find((c: any[]) => Array.isArray(c[0]) && c[0].join('').includes('sectionIntros'));
  return call ? (call[1] === null ? null : JSON.parse(call[1])) : undefined;
};
const order = (prisma: any) => Object.fromEntries(prisma.surveyQuestion.update.mock.calls.map((c: any[]) => [c[0].where.id, c[0].data.sortOrder]));

describe('SurveySectionsService (section manager)', () => {
  const qs = [q('a', 0, 'About you'), q('b', 1, 'About you'), q('c', 2, 'Your care'), q('d', 3, 'Your care'), q('e', 4, null)];

  it('renames every question in a section in one go, keeps its introduction, and audits it', async () => {
    const { prisma, audit, service } = setup(qs, { sectionIntros: { 'About you': 'A little about you.' } });
    await service.rename(actor, 's1', 'About you', 'You and your home');
    expect(prisma.surveyQuestion.updateMany).toHaveBeenCalledWith({
      where: { surveyId: 's1', deletedAt: null, sectionTitle: 'About you' },
      data: { sectionTitle: 'You and your home' },
    });
    expect(introsSaved(prisma)).toEqual({ 'You and your home': 'A little about you.' });
    expect(audit.logAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'survey_section_updated', newValues: { from: 'About you', to: 'You and your home' } }));
  });

  it('refuses a rename to another section’s name, an empty name, or a section that does not exist', async () => {
    const { service } = setup(qs);
    await expect(service.rename(actor, 's1', 'About you', 'Your care')).rejects.toThrow(/already a section called "Your care"/);
    await expect(service.rename(actor, 's1', 'About you', '  ')).rejects.toThrow(/Give the section a name/);
    await expect(service.rename(actor, 's1', 'Nope', 'X')).rejects.toThrow(/Section not found/);
  });

  it('refuses to save an order someone else changed in the meantime (two managers at once)', async () => {
    const mine = qs.map((x) => ({ ...x, surveyId: 's1' }));
    const { prisma, service } = setup(mine);
    prisma.$executeRaw = jest.fn().mockResolvedValue(1);
    // Read for the move, then (inside the locked save) the order another manager has just saved.
    prisma.surveyQuestion.findMany
      .mockResolvedValueOnce(mine)
      .mockResolvedValueOnce(mine.map((x) => (x.id === 'e' ? { ...x, sortOrder: 0 } : x.id === 'a' ? { ...x, sortOrder: 4 } : x)));
    await expect(service.move(actor, 's1', 'Your care', 'up')).rejects.toThrow(/Someone else changed the order/);
    expect(prisma.surveyQuestion.update).not.toHaveBeenCalled();
  });

  it('moves a section as a block, keeping its questions in order', async () => {
    const { prisma, service } = setup(qs);
    await service.move(actor, 's1', 'Your care', 'up');
    expect(order(prisma)).toEqual({ c: 0, d: 1, a: 2, b: 3 });
    await expect(service.move(actor, 's1', 'About you', 'up')).rejects.toThrow(/already first/);
  });

  it('refuses a move that would put a question before the one it depends on', async () => {
    const dependent = [q('a', 0, 'About you'), q('c', 1, 'Your care', { showIf: { questionKey: 'a', answers: ['Yes'] } })];
    const { prisma, service } = setup(dependent);
    await expect(service.move(actor, 's1', 'Your care', 'up')).rejects.toThrow(/"Your care" cannot move up past "About you"/);
    expect(prisma.surveyQuestion.update).not.toHaveBeenCalled();
  });

  it('removes a section but keeps its questions (and drops its introduction)', async () => {
    const { prisma, service } = setup(qs, { sectionIntros: { 'Your care': 'About the care you get.' } });
    const res = await service.remove(actor, 's1', 'Your care');
    expect(res.data.questions).toBe(2);
    expect(prisma.surveyQuestion.updateMany).toHaveBeenCalledWith({ where: { surveyId: 's1', deletedAt: null, sectionTitle: 'Your care' }, data: { sectionTitle: null } });
    expect(introsSaved(prisma)).toBeDefined();
  });

  it('a ready-made introduction: cleared or renamed away, it never comes back', async () => {
    const libraryMeta = { sections: [{ title: 'About you', introduction: 'Ready-made words.' }] };
    const a = setup(qs, { libraryMeta });
    await a.service.setIntroduction(actor, 's1', 'About you', null);
    expect(introsSaved(a.prisma)).toEqual({ 'About you': '' });
    const b = setup(qs, { libraryMeta });
    await b.service.rename(actor, 's1', 'About you', 'You');
    expect(introsSaved(b.prisma)).toEqual({ You: 'Ready-made words.', 'About you': '' });
  });

  it('an introduction is one or two short sentences', async () => {
    const { prisma, service } = setup(qs);
    await service.setIntroduction(actor, 's1', 'Your care', '  These questions are about your visits.  ');
    expect(introsSaved(prisma)).toEqual({ 'Your care': 'These questions are about your visits.' });
    await expect(service.setIntroduction(actor, 's1', 'Your care', 'x'.repeat(301))).rejects.toThrow(/at most 300/);
  });

  it('a split section: moving it is refused until it is put back together where it first appears', async () => {
    const split = [q('a', 0, 'About you'), q('c', 1, 'Your care'), q('b', 2, 'About you'), q('e', 3, null)];
    const { prisma, service } = setup(split);
    await expect(service.move(actor, 's1', 'About you', 'down')).rejects.toThrow(/Put them together/);
    await service.gather(actor, 's1', 'About you');
    expect(order(prisma)).toEqual({ b: 1, c: 2 });
  });

  it('moves one question into another section, at its end, and sets its heading', async () => {
    const { prisma, audit, service } = setup(qs);
    await service.place(actor, 's1', 'e', 'About you');
    expect(order(prisma)).toEqual({ e: 2, c: 3, d: 4 });
    expect(prisma.surveyQuestion.update).toHaveBeenCalledWith({ where: { id: 'e' }, data: { sectionTitle: 'About you' } });
    expect(audit.logAudit).toHaveBeenCalledWith(expect.objectContaining({ newValues: { questionId: 'e', from: null, to: 'About you' } }));
  });

  it('refuses to move a question above the one it depends on', async () => {
    const dependent = [q('a', 0, 'About you'), q('c', 1, 'Your care', { showIf: { questionKey: 'a', answers: ['Yes'] } }), q('d', 2, 'Other')];
    const { service } = setup(dependent);
    await expect(service.place(actor, 's1', 'a', 'Other')).rejects.toThrow(/cannot move to "Other"/);
  });

  it('a branch manager cannot change a company-wide template', async () => {
    const { service } = setup(qs, { isTemplate: true, locationIds: [] }, ['loc-1']);
    await expect(service.rename(actor, 's1', 'About you', 'X')).rejects.toThrow(/shared company template/);
  });
});

describe('section introductions (util)', () => {
  it('ready-made ones, then the survey’s own; an empty entry removes one', () => {
    const survey = {
      libraryMeta: { sections: [{ title: 'A', introduction: 'Lib A.' }, { title: 'B', introduction: 'Lib B.' }] },
      sectionIntros: { B: '', C: 'Own C.' },
    };
    expect(sectionIntrosOf(survey)).toEqual({ A: 'Lib A.', C: 'Own C.' });
    expect(sectionIntrosForCopy(survey)).toEqual({ A: 'Lib A.', C: 'Own C.' });
    expect(introsForQuestions(sectionIntrosOf(survey), [{ sectionTitle: 'C' }])).toEqual({ C: 'Own C.' });
  });

  it('finds a heading used on questions that are not next to each other', () => {
    expect(splitSections([{ sectionTitle: 'A' }, { sectionTitle: 'B' }, { sectionTitle: 'A' }])).toEqual(['A']);
    expect(splitSections([{ sectionTitle: 'A' }, { sectionTitle: 'A' }, { sectionTitle: null }])).toEqual([]);
  });
});
