import { lookupCodesFor, lookupForQuestion, lookupGroupOf, lookupOptionGroups, lookupSummary, withLookupOptions, type LookupEntry } from './survey-lookup-options';

const entries: LookupEntry[] = [
  { code: 'ARAB', name: 'Arab', isActive: true, group: 'Arab' },
  { code: 'ASIAN_GUJARATI', name: 'Asian - Gujarati', isActive: true, group: 'Asian' },
  { code: 'ASIAN_PUNJABI', name: 'Asian - Punjabi', isActive: true, group: 'Asian' },
  { code: 'WHITE_BRITISH', name: 'White - British', isActive: true, group: 'White' },
  { code: 'OLD', name: 'White - Old name', isActive: false, group: 'White' },
];

const db = (rows = entries) =>
  ({ $queryRawUnsafe: jest.fn().mockResolvedValue(rows.map(({ code, name, isActive }) => ({ code, name, isActive }))) }) as any;

describe('CareFlow-list options', () => {
  it('takes the group heading from the name', () => {
    expect(lookupGroupOf('Asian - Gujarati')).toBe('Asian');
    expect(lookupGroupOf('Arab')).toBe('Arab');
    expect(lookupGroupOf('Mixed - White and Black Caribbean')).toBe('Mixed');
  });

  it('offers only entries in use, in their groups', () => {
    expect(lookupOptionGroups(entries)).toEqual([
      { group: 'Arab', options: [{ code: 'ARAB', label: 'Arab' }] },
      { group: 'Asian', options: [{ code: 'ASIAN_GUJARATI', label: 'Asian - Gujarati' }, { code: 'ASIAN_PUNJABI', label: 'Asian - Punjabi' }] },
      { group: 'White', options: [{ code: 'WHITE_BRITISH', label: 'White - British' }] },
    ]);
  });

  it('keeps answers by code (a code given in place of a name is accepted)', () => {
    expect(lookupCodesFor(entries, ['Asian - Gujarati', 'WHITE_BRITISH', 'nonsense'])).toEqual(['ASIAN_GUJARATI', 'WHITE_BRITISH']);
  });

  it('fills a question’s options from the list (active only, or every entry for reading results)', async () => {
    const [q] = await withLookupOptions(db(), [{ id: 'q', optionsFrom: 'ETHNICITY', options: null }]);
    expect(q.options).toEqual(['Arab', 'Asian - Gujarati', 'Asian - Punjabi', 'White - British']);
    const [all] = await withLookupOptions(db(), [{ id: 'q', optionsFrom: 'ETHNICITY', options: null }], { includeRetired: true });
    expect(all.options).toContain('White - Old name');
    const plain = [{ id: 'x', optionsFrom: null, options: ['A', 'B'] }];
    expect(await withLookupOptions(db(), plain)).toBe(plain);
  });

  it('refuses a list on the wrong question type, an unknown list, or a list with its own options', async () => {
    await expect(lookupForQuestion(db(), { optionsFrom: 'ETHNICITY', questionType: 'TEXT' })).rejects.toThrow(/Only single and multiple choice/);
    await expect(lookupForQuestion(db(), { optionsFrom: 'RELIGION', questionType: 'SINGLE_SELECT' })).rejects.toThrow(/Choose a CareFlow list/);
    await expect(lookupForQuestion(db(), { optionsFrom: 'ETHNICITY', questionType: 'SINGLE_SELECT', options: ['A'] })).rejects.toThrow(/not both/);
    await expect(lookupForQuestion(db(), { optionsFrom: 'ethnicity', questionType: 'SINGLE_SELECT' })).resolves.toMatchObject({ key: 'ETHNICITY' });
    expect(await lookupForQuestion(db(), { optionsFrom: null, questionType: 'SINGLE_SELECT' })).toBeNull();
  });

  describe('results', () => {
    const answers = (codes: string[]) => codes.map((c) => ({ lookupCodes: [c], selectedOptions: [entries.find((e) => e.code === c)?.name ?? c] }));

    it('counts by group heading, showing a detailed entry only where enough people chose it', () => {
      const s = lookupSummary(entries, [...answers(Array(10).fill('ASIAN_GUJARATI')), ...answers(['ASIAN_PUNJABI', 'ARAB', 'WHITE_BRITISH'])], 10);
      expect(s.groups).toEqual([
        { label: 'Asian', count: 11, percent: 85 },
        { label: 'Arab', count: 1, percent: 8 },
        { label: 'White', count: 1, percent: 8 },
      ]);
      expect(s.details).toEqual([{ group: 'Asian', label: 'Asian - Gujarati', count: 10 }]);
      expect(s.detailsHidden).toBe(2); // Punjabi and White - British: in their groups only
    });

    it('survives renaming and retiring an entry (counted by code, named as it is now)', () => {
      const renamed = entries.map((e) => (e.code === 'ASIAN_GUJARATI' ? { ...e, name: 'Asian or Asian British - Gujarati', group: 'Asian or Asian British' } : e));
      const s = lookupSummary(renamed, [{ lookupCodes: ['ASIAN_GUJARATI'], selectedOptions: ['Asian - Gujarati'] }, { lookupCodes: ['OLD'], selectedOptions: ['White - Old name'] }], 10);
      expect(s.groups.map((g) => g.label).sort()).toEqual(['Asian or Asian British', 'White']);
    });

    it('reads answers from before codes were kept by their name', () => {
      const s = lookupSummary(entries, [{ selectedOptions: ['Arab'] }], 10);
      expect(s.groups).toEqual([{ label: 'Arab', count: 1, percent: 100 }]);
    });
  });
});
