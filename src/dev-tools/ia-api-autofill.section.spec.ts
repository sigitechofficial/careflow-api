import { BadRequestException } from '@nestjs/common';
import { IaApiAutofillService } from './ia-api-autofill.service';

/**
 * Section-scoped QA demo population (`runSection`). Verifies tab isolation, profile/secure
 * exclusion, validation, and that the whole assessment is never submitted.
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
  const saveAnswers = jest.fn().mockResolvedValue({ data: [] });
  const updateSubmission = jest.fn().mockResolvedValue({ data: {} });
  const submitAssessment = jest.fn().mockResolvedValue({ data: {} });

  // group questions by section for the template shape
  const bySection = new Map<number, Q[]>();
  for (const it of sectionsQuestions) {
    const list = bySection.get(it.sectionNumber) ?? [];
    const { sectionNumber, ...rest } = it;
    void sectionNumber;
    list.push(rest);
    bySection.set(it.sectionNumber, list);
  }
  const sections = [...bySection.entries()].map(([sectionNumber, questions]) => ({
    sectionNumber,
    questions: questions.map((qq) => ({ ...qq, options: undefined })),
  }));

  const assessments = {
    getSubmissions: jest.fn().mockResolvedValue({ data: [{ id: 'sub-1', status: 'IN_PROGRESS' }] }),
    createSubmission: jest.fn(),
    updateStatus: jest.fn(),
    getSubmissionById: jest.fn().mockResolvedValue({ data: { id: 'sub-1', status: 'IN_PROGRESS', metadata: {} } }),
    getAnswers: jest.fn().mockResolvedValue({ data: [] }),
    saveAnswers,
    updateSubmission,
    submitAssessment,
  };
  const templates = { getDefaultTemplate: jest.fn().mockResolvedValue({ data: { sections } }) };

  const service = new IaApiAutofillService(assessments as never, templates as never);
  return { service, saveAnswers, updateSubmission, submitAssessment };
}

/** All questionIds passed to saveAnswers across chunks. */
function writtenIds(saveAnswers: jest.Mock): string[] {
  return saveAnswers.mock.calls.flatMap((c) => (c[3]?.answers ?? []).map((a: { questionId: string }) => a.questionId));
}

describe('IaApiAutofillService.runSection', () => {
  it('writes only the requested section-A questions, never section B', async () => {
    const { service, saveAnswers, submitAssessment } = makeService([
      q('a1', 5),
      q('a2', 5),
      q('b1', 11),
    ]);

    await service.runSection('user-1', 'su-1', 'critical', 10, ['a1', 'a2']);

    const ids = writtenIds(saveAnswers);
    expect(ids.sort()).toEqual(['a1', 'a2']);
    expect(ids).not.toContain('b1'); // Section B untouched
    // Never submits the whole assessment from a section fill.
    expect(submitAssessment).not.toHaveBeenCalled();
  });

  it('populating Section A does not modify Section B (isolation)', async () => {
    const { service, saveAnswers } = makeService([q('a1', 5), q('b1', 11), q('b2', 11)]);
    await service.runSection('user-1', 'su-1', 'critical', 10, ['a1']);
    const ids = writtenIds(saveAnswers);
    expect(ids).toEqual(['a1']);
    expect(ids).not.toContain('b1');
    expect(ids).not.toContain('b2');
  });

  it('excludes profile (prefillKey) and secure (secureField) fields even if requested', async () => {
    const { service, saveAnswers } = makeService([
      q('plain', 1),
      q('dob', 1, { metadata: { prefillKey: 'dateOfBirth' } }),
      q('keysafe', 1, { metadata: { secureField: true } }),
    ]);

    await service.runSection('user-1', 'su-1', 'critical', 1, ['plain', 'dob', 'keysafe']);

    const ids = writtenIds(saveAnswers);
    expect(ids).toContain('plain');
    expect(ids).not.toContain('dob'); // profile-sourced, protected
    expect(ids).not.toContain('keysafe'); // secure, protected
  });

  it('ignores questionIds not in the template (no accidental writes)', async () => {
    const { service, saveAnswers } = makeService([q('a1', 5)]);
    await service.runSection('user-1', 'su-1', 'critical', 10, ['a1', 'does-not-exist']);
    expect(writtenIds(saveAnswers)).toEqual(['a1']);
  });

  it.each([0, 19, -1, 1.5])('rejects an invalid tabId (%p)', async (tabId) => {
    const { service } = makeService([q('a1', 5)]);
    await expect(service.runSection('user-1', 'su-1', 'critical', tabId, ['a1'])).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('applies only the tab-owned worksheet metadata (Waterlow tab → waterlow key)', async () => {
    const { service, updateSubmission } = makeService([q('a1', 11)]);
    await service.runSection('user-1', 'su-1', 'critical', 5, []); // tab 5 = Waterlow
    // updateSubmission called with a metadata patch containing only tab 5's keys.
    const patch = updateSubmission.mock.calls[0]?.[3]?.metadata as Record<string, unknown> | undefined;
    expect(patch).toBeDefined();
    expect(Object.keys(patch ?? {})).toContain('waterlow');
    expect(Object.keys(patch ?? {})).not.toContain('painAssessment');
    expect(Object.keys(patch ?? {})).not.toContain('mustAssessment');
  });
});

describe('IaApiAutofillService level selection', () => {
  it.each(['low', 'normal', 'critical'] as const)('accepts the %s severity level', async (level) => {
    const { service, saveAnswers } = makeService([q('a1', 5)]);
    await expect(service.runSection('user-1', 'su-1', level, 10, ['a1'])).resolves.toMatchObject({ tabId: 10 });
    // 'a1' is required, so every level fills it.
    expect(writtenIds(saveAnswers)).toContain('a1');
  });
});
