import { OrgScopeService } from '../common/org-scope/org-scope.service';
import { SurveyLibraryService } from './survey-library.service';

/**
 * Reading a ready-made survey: a question answered from a CareFlow list (ethnicity …) shows the
 * organisation's own entries in use, grouped as the answer form shows them; other questions are unchanged.
 */
jest.mock('./survey-lookup-options', () => {
  const actual = jest.requireActual('./survey-lookup-options');
  return {
    ...actual,
    withLookupOptions: jest.fn(async (_db: unknown, questions: Array<{ id: string; optionsFrom: string | null; options: unknown }>) =>
      questions.map((q) =>
        q.optionsFrom === 'ETHNICITY'
          ? {
              ...q,
              options: ['White British', 'Indian'],
              lookupEntries: [
                { code: 'WB', name: 'White British', group: 'White', isActive: true },
                { code: 'AI', name: 'Indian', group: 'Asian or Asian British', isActive: true },
                { code: 'OLD', name: 'Retired entry', group: 'White', isActive: false },
              ],
            }
          : q,
      ),
    ),
  };
});

describe('ready-made survey detail: CareFlow list questions', () => {
  it('fills the organisation’s list entries in use, grouped, and leaves other questions alone', async () => {
    const prisma: any = {};
    const service = new SurveyLibraryService(prisma, new OrgScopeService(prisma), { logAudit: jest.fn() } as any);
    const sections = [
      {
        title: 'About you',
        questions: [
          { id: 'e1', optionsFrom: 'ETHNICITY', options: null as string[] | null },
          { id: 'q2', optionsFrom: null, options: ['Yes', 'No'] },
        ],
      },
    ];
    const out = await (service as any).withListOptions(sections, [
      { id: 'e1', optionsFrom: 'ETHNICITY', options: null },
      { id: 'q2', optionsFrom: null, options: ['Yes', 'No'] },
    ]);
    const [e1, q2] = out[0].questions;
    expect(e1.options).toEqual(['White British', 'Indian']);
    expect(e1.optionGroups).toEqual([
      { group: 'White', options: [{ code: 'WB', label: 'White British' }] },
      { group: 'Asian or Asian British', options: [{ code: 'AI', label: 'Indian' }] },
    ]);
    expect(q2).toEqual({ id: 'q2', optionsFrom: null, options: ['Yes', 'No'] });
  });

  it('a survey with no list questions is returned as it is, without a lookup', async () => {
    const lookups = jest.requireMock('./survey-lookup-options') as { withLookupOptions: jest.Mock };
    lookups.withLookupOptions.mockClear();
    const prisma: any = {};
    const service = new SurveyLibraryService(prisma, new OrgScopeService(prisma), { logAudit: jest.fn() } as any);
    const sections = [{ title: null, questions: [{ id: 'q1', optionsFrom: null }] }];
    expect(await (service as any).withListOptions(sections, [{ id: 'q1', optionsFrom: null, options: null }])).toBe(sections);
    expect(lookups.withLookupOptions).not.toHaveBeenCalled();
  });
});
