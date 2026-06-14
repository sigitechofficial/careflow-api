import { CarePathwayFormType } from '@prisma/client';
import { listCarePathwayAssessmentCatalogForms } from './assessment-catalogue.util';

function makeForm(id: string, name: string) {
  return {
    id,
    name,
    description: null,
    formType: CarePathwayFormType.ASSESSMENT,
    status: 'PUBLISHED',
    lastPublishedAt: new Date('2026-01-01'),
    pictureUrl: null,
    versionLabel: '1',
    isActive: true,
    deletedAt: null,
  };
}

describe('listCarePathwayAssessmentCatalogForms', () => {
  it('returns form-selection assessments when configured', async () => {
    const form = makeForm('form-1', 'Capability Assessment');
    const client = {
      defaultFormSelection: {
        findMany: jest.fn().mockResolvedValue([{ form }]),
      },
      carePathwayForm: { findMany: jest.fn() },
    };

    const result = await listCarePathwayAssessmentCatalogForms(client as never);

    expect(result.source).toBe('form_selection');
    expect(result.forms).toHaveLength(1);
    expect(result.forms[0]?.name).toBe('Capability Assessment');
    expect(client.carePathwayForm.findMany).not.toHaveBeenCalled();
  });

  it('falls back to all active assessment forms when none selected', async () => {
    const form = makeForm('form-2', 'Bed Rail Assessment');
    const client = {
      defaultFormSelection: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      carePathwayForm: {
        findMany: jest.fn().mockResolvedValue([form]),
      },
    };

    const result = await listCarePathwayAssessmentCatalogForms(client as never);

    expect(result.source).toBe('all_published');
    expect(result.forms).toHaveLength(1);
    expect(result.forms[0]?.id).toBe('form-2');
  });
});
