import { CqcMockInspectionPoliciesService } from './cqc-mock-inspection-policies.service';

const guidance = (policies?: string[]) => ({
  lookAt: ['x'],
  askPeople: [],
  askStaff: [],
  inCareFlow: [],
  ...(policies ? { policies } : {}),
});

const libraryPolicy = (
  reference: string,
  title: string,
  adoptedPolicyId: string | null = null,
) => ({
  id: `lib-${reference}`,
  reference,
  title,
  documentType: 'POLICY',
  category: { id: 'c', name: 'Medicines', code: 'MED', displayOrder: 1 },
  adoptedPolicyId,
});

describe('CqcMockInspectionPoliciesService', () => {
  it('lists the ready-made policies behind each statement, with whether they are adopted', async () => {
    const prisma = {
      cqcMockInspectionTemplate: {
        findMany: jest.fn().mockResolvedValue([
          {
            statements: [
              {
                code: 'SAFE_MEDICINES',
                focus: null,
                guidance: guidance([
                  'POL-MED-001',
                  'POL-MED-014',
                  'POL-GONE-001',
                ]),
              },
              {
                code: 'WELL_LED_GOVERNANCE',
                focus: null,
                guidance: guidance(['POL-GOV-002']),
              },
            ],
          },
          // A second template repeats a statement: the first one's links are used.
          {
            statements: [
              {
                code: 'SAFE_MEDICINES',
                focus: 'x',
                guidance: guidance(['POL-GOV-002']),
              },
            ],
          },
          // A template seeded before policies were added gives nothing for its statements.
          {
            statements: [
              { code: 'SAFE_IPC', focus: null, guidance: guidance() },
            ],
          },
        ]),
      },
      policyDocument: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'org-pol-1', status: 'DRAFT', versions: [{ status: 'DRAFT' }] },
          {
            id: 'org-pol-2',
            status: 'ARCHIVED',
            versions: [{ status: 'PUBLISHED' }],
          },
        ]),
      },
    };
    const library = {
      list: jest.fn().mockResolvedValue({
        data: [
          libraryPolicy(
            'POL-MED-001',
            'Medicines Management Policy',
            'org-pol-1',
          ),
          libraryPolicy('POL-MED-014', 'Medication Errors Procedure'),
          libraryPolicy(
            'POL-GOV-002',
            'Governance and Quality Assurance Policy',
            'org-pol-2',
          ),
        ],
      }),
    };
    const service = new CqcMockInspectionPoliciesService(
      prisma as any,
      library as any,
    );

    const { data } = await service.byStatement();

    expect(prisma.cqcMockInspectionTemplate.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { retiredAt: null } }),
    );
    expect(data.SAFE_MEDICINES).toEqual([
      {
        id: 'lib-POL-MED-001',
        reference: 'POL-MED-001',
        title: 'Medicines Management Policy',
        documentType: 'POLICY',
        categoryName: 'Medicines',
        adoptedPolicyId: 'org-pol-1',
        adoptedStatus: 'DRAFT',
        canUndoAdopt: true,
      },
      expect.objectContaining({
        reference: 'POL-MED-014',
        adoptedPolicyId: null,
        adoptedStatus: null,
        canUndoAdopt: false,
      }),
    ]);
    expect(prisma.policyDocument.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: ['org-pol-1', 'org-pol-2'] } },
      }),
    );
    // An archived (once published) copy is shown as archived and cannot be undone.
    expect(data.WELL_LED_GOVERNANCE).toEqual([
      expect.objectContaining({
        reference: 'POL-GOV-002',
        adoptedStatus: 'ARCHIVED',
        canUndoAdopt: false,
      }),
    ]);
    expect(data.SAFE_IPC).toBeUndefined();
  });
});
