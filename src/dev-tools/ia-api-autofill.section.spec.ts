import { BadRequestException } from '@nestjs/common';
import { IaApiAutofillService } from './ia-api-autofill.service';

/**
 * Section-scoped QA demo GENERATION (`generateSection`). Verifies tab scoping, profile/secure
 * exclusion, validation, and — critically — that NOTHING is persisted (no submission, no save).
 */
type Q = {
  id: string;
  questionText: string;
  questionType: string;
  isRequired: boolean;
  sortOrder: number;
  metadata: Record<string, unknown> | null;
};

function q(id: string, section: number, extra: Partial<Q> = {}): Q & { sectionNumber: number } {
  return {
    id,
    questionText: `Question ${id}`,
    questionType: 'YES_NO',
    isRequired: true,
    sortOrder: 1,
    metadata: null,
    sectionNumber: section,
    ...extra,
  };
}

function makeService(sectionsQuestions: Array<Q & { sectionNumber: number }>) {
  // Group flat questions into template sections.
  const bySection = new Map<number, Q[]>();
  for (const it of sectionsQuestions) {
    const { sectionNumber, ...rest } = it;
    const list = bySection.get(sectionNumber) ?? [];
    list.push(rest);
    bySection.set(sectionNumber, list);
  }
  const sections = [...bySection.entries()].map(([sectionNumber, questions]) => ({
    sectionNumber,
    questions: questions.map((qq) => ({ ...qq, options: undefined })),
  }));

  const getDefaultTemplate = jest.fn().mockResolvedValue({ data: { sections } });
  // Any persistence method, if ever called, must fail the test.
  const forbidden = jest.fn(() => {
    throw new Error('generateSection must not persist anything');
  });
  const assessments = {
    getSubmissions: forbidden,
    createSubmission: forbidden,
    updateStatus: forbidden,
    getSubmissionById: forbidden,
    getAnswers: forbidden,
    saveAnswers: forbidden,
    updateSubmission: forbidden,
    submitAssessment: forbidden,
  };
  const templates = { getDefaultTemplate };

  const service = new IaApiAutofillService(templates as never);
  return { service, getDefaultTemplate, forbidden, assessments };
}

describe('IaApiAutofillService.generateSection', () => {
  it('returns only the requested section-A questions, never section B — and persists nothing', async () => {
    const { service, forbidden } = makeService([q('a1', 5), q('a2', 5), q('b1', 11)]);

    const res = await service.generateSection('critical', 10, ['a1', 'a2']);

    const ids = res.answers.map((a) => a.questionId).sort();
    expect(ids).toEqual(['a1', 'a2']);
    expect(ids).not.toContain('b1');
    expect(forbidden).not.toHaveBeenCalled(); // no submission created / saved / submitted
  });

  it('fills empty identity prefills and never overwrites occupied profile or secure fields', async () => {
    const { service } = makeService([
      q('plain', 1),
      q('dob', 1, { questionText: 'Date of birth', questionType: 'DATE', metadata: { prefillKey: 'dateOfBirth' } }),
      q('keysafe', 1, { metadata: { secureField: true } }),
    ]);

    const empty = await service.generateSection('critical', 1, ['plain', 'dob', 'keysafe']);
    expect(empty.answers.map((a) => a.questionId)).toEqual(expect.arrayContaining(['plain', 'dob']));
    expect(empty.answers.map((a) => a.questionId)).not.toContain('keysafe');
    expect(empty.profilePatch.address?.addressLine1).toBeTruthy();
    expect(empty.profilePatch.gp?.name).toBeTruthy();

    const occupied = await service.generateSection('critical', 1, ['plain', 'dob', 'keysafe'], {
      dateOfBirth: '1944-03-12',
      addressLine1: '99 Existing Street',
      gpName: 'Dr Existing',
    });
    expect(occupied.answers.map((a) => a.questionId)).toContain('plain');
    expect(occupied.answers.map((a) => a.questionId)).not.toContain('dob');
    expect(occupied.answers.map((a) => a.questionId)).not.toContain('keysafe');
    expect(occupied.profilePatch.address?.addressLine1).toBeUndefined();
    expect(occupied.profilePatch.gp?.name).toBeUndefined();
  });

  it('fills About Me prefill fields and empty identity fields such as date of birth', async () => {
    const { service } = makeService([
      q('about', 1, {
        questionText: 'People who are important to me',
        questionType: 'TEXTAREA',
        metadata: { specRef: '1.3a', aboutMeProfileField: true, prefillKey: 'aboutMe_peopleImportantToMe' },
      }),
      q('dob', 1, { metadata: { prefillKey: 'dateOfBirth' } }),
    ]);
    const res = await service.generateSection('normal', 1, ['about', 'dob']);
    const ids = res.answers.map((a) => a.questionId);
    expect(ids).toContain('about');
    expect(ids).toContain('dob');
    expect(res.answers.find((a) => a.questionId === 'about')?.textValue).toMatch(/^(I |I'm |Please |My )/i);
  });

  it('ignores questionIds not in the template', async () => {
    const { service } = makeService([q('a1', 5)]);
    const res = await service.generateSection('critical', 10, ['a1', 'nope']);
    expect(res.answers.map((a) => a.questionId)).toEqual(['a1']);
  });

  it.each([0, 25, -1, 1.5])('rejects an invalid tabId (%p)', async (tabId) => {
    const { service } = makeService([q('a1', 5)]);
    await expect(service.generateSection('critical', tabId, ['a1'])).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it.each([19, 20, 21, 22])('accepts registered holistic tabId %p', async (tabId) => {
    const sectionNumber = tabId === 19 ? 16 : tabId === 20 ? 17 : tabId === 21 ? 15 : 18;
    const { service } = makeService([q('a1', sectionNumber)]);
    const res = await service.generateSection('critical', tabId, ['a1']);
    expect(res.answers.map((a) => a.questionId)).toContain('a1');
  });

  it('tab 11 Fill Demo writes nested therapyAideMemoire without a top-level key', async () => {
    const { service } = makeService([]);
    const res = await service.generateSection('critical', 11, []);
    expect(res.metadata.therapyAideMemoire).toBeUndefined();
    const pain = res.metadata.painAssessment as {
      nrsScore?: number;
      abbey?: unknown;
      therapyAideMemoire?: {
        furtherReferralRequired?: boolean;
        mobilityChange?: { checked?: boolean; details?: string };
        choking?: { checked?: boolean };
      };
    };
    expect(pain.nrsScore).toBeUndefined();
    expect(pain.abbey).toBeUndefined();
    expect(pain.therapyAideMemoire?.furtherReferralRequired).toBe(false);
    expect(pain.therapyAideMemoire?.choking?.checked).toBe(false);
    expect(pain.therapyAideMemoire?.mobilityChange?.checked).toBe(true);
    expect(pain.therapyAideMemoire?.mobilityChange?.details?.trim()).toBeTruthy();
  });

  it('tab 6 owns equipment selection and checklist; Stable does not invent hoist/bed', async () => {
    const { service } = makeService([]);
    const res = await service.generateSection('low', 6, []);
    expect(res.metadata.equipmentSelection).toEqual(
      expect.objectContaining({
        selectedEquipment: 'Standard foam mattress — no additional pressure equipment',
      }),
    );
    expect(res.metadata.equipmentChecklist).toEqual(
      expect.objectContaining({
        hoistServiced: false,
        profilingBedServiced: false,
      }),
    );
  });

  it('returns only the tab-owned worksheet metadata (Waterlow tab → waterlow key)', async () => {
    const { service } = makeService([q('a1', 11)]);
    const res = await service.generateSection('critical', 5, []); // tab 5 = Waterlow
    expect(Object.keys(res.metadata)).toContain('waterlow');
    expect(Object.keys(res.metadata)).not.toContain('painAssessment');
    expect(Object.keys(res.metadata)).not.toContain('mustAssessment');
  });

  it.each(['low', 'normal', 'critical'] as const)('accepts the %s severity level', async (level) => {
    const { service } = makeService([q('a1', 5)]);
    const res = await service.generateSection(level, 10, ['a1']);
    expect(res.answers.map((a) => a.questionId)).toContain('a1'); // required → filled at every level
  });

  it('does not persist when expanding follow-ups or tab extras', async () => {
    const { service, forbidden } = makeService([
      q('wounds', 11, { questionText: 'Currently has ulcers or wounds?', metadata: { fieldKey: 'hasWounds' } }),
      q('wound-assessment', 11, { questionText: 'Has wound assessment been completed?' }),
      q('access', 3, {
        questionText: 'Access instructions for staff',
        metadata: { specRef: '3.5', prefillKey: 'accessInstruction' },
      }),
    ]);
    const res = await service.generateSection('critical', 1, ['wounds']);
    expect(res.answers.map((a) => a.questionId)).toEqual(
      expect.arrayContaining(['wounds', 'wound-assessment']),
    );
    expect(res.answers.map((a) => a.questionId)).not.toContain('access');
    expect(forbidden).not.toHaveBeenCalled();
  });
});
