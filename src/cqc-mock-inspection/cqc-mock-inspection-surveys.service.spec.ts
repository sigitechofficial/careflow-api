import { CqcMockInspectionSurveysService } from './cqc-mock-inspection-surveys.service';

const statements = [
  {
    id: 's-1',
    code: 'SAFE_MEDICINES',
    title: 'Medicines optimisation',
    aliases: ['Medicine optimisation'],
    keyQuestionCode: 'SAFE',
  },
  {
    id: 's-2',
    code: 'CARING_KINDNESS_DIGNITY',
    title: 'Kindness, compassion and dignity',
    aliases: [],
    keyQuestionCode: 'CARING',
  },
  {
    id: 's-3',
    code: 'WELL_LED_GOVERNANCE',
    title: 'Governance, management and sustainability',
    aliases: [],
    keyQuestionCode: 'WELL_LED',
  },
];

const survey = (over: Record<string, unknown>) => ({
  id: 'lib-1',
  reference: 'SUR-PWS-001',
  title: 'How is your care?',
  respondents: 'People we support',
  audience: 'SERVICE_USER',
  group: {
    code: 'PEOPLE_WE_SUPPORT',
    short: 'PWS',
    name: 'People we support',
    displayOrder: 10,
  },
  adoptedTemplateId: null,
  cqc: { keyQuestions: ['SAFE', 'CARING'], qualityStatements: [] },
  ...over,
});

describe('CqcMockInspectionSurveysService', () => {
  it('lists the ready-made surveys for each statement, matching aliases and key question prefixes', async () => {
    const library = {
      list: jest.fn().mockResolvedValue({
        data: [
          survey({
            cqc: {
              keyQuestions: [],
              qualityStatements: [
                'Medicine optimisation',
                'Caring: Kindness, compassion and dignity',
              ],
            },
          }),
          survey({
            id: 'lib-2',
            reference: 'SUR-STF-001',
            title: 'Staff survey',
            respondents: 'Staff',
            audience: 'EMPLOYEE',
            group: {
              code: 'STAFF',
              short: 'STF',
              name: 'Staff',
              displayOrder: 30,
            },
            adoptedTemplateId: 'tpl-9',
            cqc: {
              keyQuestions: [],
              qualityStatements: [
                'Kindness, compassion and dignity',
                'Not a statement',
              ],
            },
          }),
        ],
      }),
    };
    const framework = { active: jest.fn().mockResolvedValue({ statements }) };
    const service = new CqcMockInspectionSurveysService(
      library as any,
      framework as any,
    );

    const { data } = await service.byStatement();

    expect(data.SAFE_MEDICINES.map((s) => s.reference)).toEqual([
      'SUR-PWS-001',
    ]);
    // The staff survey covers one statement, so it comes before the two-statement survey.
    expect(data.CARING_KINDNESS_DIGNITY.map((s) => s.reference)).toEqual([
      'SUR-STF-001',
      'SUR-PWS-001',
    ]);
    expect(data.CARING_KINDNESS_DIGNITY[0]).toEqual({
      id: 'lib-2',
      reference: 'SUR-STF-001',
      title: 'Staff survey',
      respondents: 'Staff',
      audience: 'EMPLOYEE',
      groupName: 'Staff',
      adoptedTemplateId: 'tpl-9',
      statementCount: 1,
    });
    expect(data.WELL_LED_GOVERNANCE).toBeUndefined();
  });
});
